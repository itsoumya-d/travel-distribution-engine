import { describe, it, expect, beforeEach } from "vitest";
import { FlightOfferAggregator, BookingEngine } from "./aggregator.js";

describe("Travel Distribution Engine", () => {
  let aggregator: FlightOfferAggregator;
  let bookingEngine: BookingEngine;

  beforeEach(() => {
    aggregator = new FlightOfferAggregator();
    bookingEngine = new BookingEngine(aggregator, 15);
  });

  it("normalizes raw provider offers and computes route signature hash", () => {
    const offer = aggregator.ingestRawOffer("amadeus", {
      carrierCode: "BA",
      flightNumber: "142",
      origin: "del",
      destination: "lhr",
      durationMinutes: 570,
      cabinClass: "economy",
      totalAmount: 520,
    });

    expect(offer.carrierCode).toBe("BA");
    expect(offer.totalAmountCents).toBe(52000);
    expect(offer.segments[0]?.origin).toBe("DEL");
    expect(offer.segments[0]?.destination).toBe("LHR");
  });

  it("deduplicates identical routes across providers and keeps best price", () => {
    const flight1 = { carrierCode: "VS", flightNumber: "301", origin: "LHR", destination: "JFK", totalAmount: 600 };
    const flight2 = { carrierCode: "VS", flightNumber: "301", origin: "LHR", destination: "JFK", totalAmount: 540 };

    aggregator.ingestRawOffer("prov1", flight1);
    aggregator.ingestRawOffer("prov2", flight2);

    const res = aggregator.search({ origin: "LHR", destination: "JFK" });
    expect(res.totalMatches).toBe(1);
    expect(res.offers[0]?.totalAmountCents).toBe(54000);
  });

  it("supports cursor-based pagination across search catalog", () => {
    for (let i = 1; i <= 5; i++) {
      aggregator.ingestRawOffer("prov", {
        carrierCode: "LH",
        flightNumber: `40${i}`,
        origin: "FRA",
        destination: "LHR",
        totalAmount: 100 + i * 10,
        durationMinutes: 90,
      });
    }

    const p1 = aggregator.search({ origin: "FRA", destination: "LHR", limit: 2 });
    expect(p1.offers).toHaveLength(2);
    expect(p1.hasMore).toBe(true);

    const p2 = aggregator.search({ origin: "FRA", destination: "LHR", limit: 2, cursor: p1.nextCursor! });
    expect(p2.offers).toHaveLength(2);

    const p3 = aggregator.search({ origin: "FRA", destination: "LHR", limit: 2, cursor: p2.nextCursor! });
    expect(p3.offers).toHaveLength(1);
    expect(p3.hasMore).toBe(false);
  });

  it("creates idempotent booking reservations and handles confirmation lifecycle", () => {
    const offer = aggregator.ingestRawOffer("prov", {
      carrierCode: "AF",
      flightNumber: "112",
      origin: "CDG",
      destination: "LHR",
      totalAmount: 200,
    });

    const res1 = bookingEngine.createHoldReservation("idem_99", offer.id, [
      { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
    ]);
    const res2 = bookingEngine.createHoldReservation("idem_99", offer.id, [
      { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
    ]);

    expect(res1.reservationId).toBe(res2.reservationId);
    expect(res1.status).toBe("HELD");

    const confirmed = bookingEngine.confirmBooking(res1.reservationId);
    expect(confirmed.status).toBe("CONFIRMED");

    const cancelled = bookingEngine.cancelReservation(res1.reservationId);
    expect(cancelled.status).toBe("CANCELLED");
  });
});
