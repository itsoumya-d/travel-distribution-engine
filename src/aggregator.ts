import { createHash, randomUUID } from "node:crypto";

export type CabinClass = "economy" | "premium_economy" | "business" | "first";

export interface FlightSegment {
  carrierCode: string;
  flightNumber: string;
  origin: string;
  destination: string;
  durationMinutes: number;
}

export interface FlightOffer {
  id: string;
  provider: string;
  carrierCode: string;
  cabinClass: CabinClass;
  totalAmountCents: number;
  currency: string;
  segments: FlightSegment[];
  expiresAt: string;
  hashKey: string;
}

export interface SearchOffersQuery {
  origin: string;
  destination: string;
  cabinClass?: CabinClass;
  limit?: number;
  cursor?: string;
  sortBy?: "price" | "duration";
}

export interface PaginatedOffersResult {
  offers: FlightOffer[];
  nextCursor: string | null;
  totalMatches: number;
  hasMore: boolean;
}

export class FlightOfferAggregator {
  private offers: Map<string, FlightOffer> = new Map();

  public computeOfferHash(carrier: string, segments: FlightSegment[], cabin: CabinClass): string {
    const routeSig = segments.map((s) => `${s.carrierCode}${s.flightNumber}:${s.origin}->${s.destination}`).join("|");
    return createHash("sha256").update(`${carrier}:${cabin}:${routeSig}`).digest("hex").slice(0, 16);
  }

  public ingestRawOffer(providerId: string, raw: Record<string, unknown>): FlightOffer {
    const rawSegs = (Array.isArray(raw.segments) ? raw.segments : [raw]) as Record<string, unknown>[];
    const segments: FlightSegment[] = rawSegs.map((s) => ({
      carrierCode: String(s.carrierCode || s.airline || "").toUpperCase(),
      flightNumber: String(s.flightNumber || s.flight_no || ""),
      origin: String(s.origin || s.from || "").toUpperCase(),
      destination: String(s.destination || s.to || "").toUpperCase(),
      durationMinutes: Number(s.durationMinutes || s.duration_mins || 0),
    }));

    const carrier = String(raw.carrierCode || segments[0]?.carrierCode || "YY").toUpperCase();
    const cabin = String(raw.cabinClass || raw.cabin || "economy").toLowerCase() as CabinClass;
    const totalAmount = Math.round(Number(raw.totalAmount || raw.total || raw.baseAmount || 0) * 100);
    const hashKey = this.computeOfferHash(carrier, segments, cabin);
    const offer: FlightOffer = {
      id: `off_${providerId}_${hashKey}`,
      provider: providerId,
      carrierCode: carrier,
      cabinClass: cabin,
      totalAmountCents: totalAmount,
      currency: String(raw.currency || "GBP").toUpperCase(),
      segments,
      expiresAt: String(raw.expiresAt || new Date(Date.now() + 1800000).toISOString()),
      hashKey,
    };

    const existing = Array.from(this.offers.values()).find((o) => o.hashKey === hashKey);
    if (!existing || offer.totalAmountCents < existing.totalAmountCents) {
      if (existing) this.offers.delete(existing.id);
      this.offers.set(offer.id, offer);
    }
    return offer;
  }

  public search(query: SearchOffersQuery): PaginatedOffersResult {
    let matches = Array.from(this.offers.values()).filter((o) => {
      const first = o.segments[0], last = o.segments[o.segments.length - 1];
      if (!first || !last) return false;
      if (first.origin !== query.origin.toUpperCase() || last.destination !== query.destination.toUpperCase()) return false;
      return !query.cabinClass || o.cabinClass === query.cabinClass;
    });

    if (query.sortBy === "duration") {
      matches.sort((a, b) => a.segments.reduce((acc, s) => acc + s.durationMinutes, 0) - b.segments.reduce((acc, s) => acc + s.durationMinutes, 0));
    } else {
      matches.sort((a, b) => a.totalAmountCents - b.totalAmountCents);
    }

    const limit = Math.max(1, Math.min(query.limit || 10, 50));
    let offset = 0;
    if (query.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf-8"));
        if (typeof decoded.offset === "number" && decoded.offset >= 0) offset = decoded.offset;
      } catch { offset = 0; }
    }

    const page = matches.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    const hasMore = nextOffset < matches.length;
    return {
      offers: page,
      nextCursor: hasMore ? Buffer.from(JSON.stringify({ offset: nextOffset }), "utf-8").toString("base64url") : null,
      totalMatches: matches.length,
      hasMore,
    };
  }

  public getOffer(id: string): FlightOffer | undefined {
    return this.offers.get(id);
  }
}

export interface BookingReservation {
  reservationId: string;
  idempotencyKey: string;
  offerId: string;
  passengers: Array<{ firstName: string; lastName: string; email: string }>;
  status: "HELD" | "CONFIRMED" | "CANCELLED" | "EXPIRED";
  holdExpiresAt: string;
  totalAmountCents: number;
}

export class BookingEngine {
  private reservations: Map<string, BookingReservation> = new Map();
  private idempotencyMap: Map<string, string> = new Map();

  constructor(private aggregator: FlightOfferAggregator, private holdMins: number = 20) {}

  public createHoldReservation(key: string, offerId: string, passengers: Array<{ firstName: string; lastName: string; email: string }>): BookingReservation {
    if (this.idempotencyMap.has(key)) return this.reservations.get(this.idempotencyMap.get(key)!)!;
    const offer = this.aggregator.getOffer(offerId);
    if (!offer) throw new Error(`Offer not found: ${offerId}`);
    if (!passengers.length) throw new Error("At least one passenger required");

    const reservationId = `res_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const reservation: BookingReservation = {
      reservationId,
      idempotencyKey: key,
      offerId,
      passengers,
      status: "HELD",
      holdExpiresAt: new Date(Date.now() + this.holdMins * 60000).toISOString(),
      totalAmountCents: offer.totalAmountCents * passengers.length,
    };
    this.reservations.set(reservationId, reservation);
    this.idempotencyMap.set(key, reservationId);
    return reservation;
  }

  public confirmBooking(id: string): BookingReservation {
    const res = this.reservations.get(id);
    if (!res) throw new Error(`Reservation not found: ${id}`);
    if (res.status === "CONFIRMED") return res;
    if (res.status === "CANCELLED") throw new Error("Cannot confirm cancelled reservation");
    res.status = "CONFIRMED";
    return res;
  }

  public cancelReservation(id: string): BookingReservation {
    const res = this.reservations.get(id);
    if (!res) throw new Error(`Reservation not found: ${id}`);
    res.status = "CANCELLED";
    return res;
  }
}
