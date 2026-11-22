// Prevention, idea 2: register a trip paid in advance (e.g. a Supersaver ticket,
// bound to its trains). From 3 h before departure until arrival the backend
// checks every change and warns before one is missed.
import { useState } from "react";
import { addBooking, USER_ID } from "../api/client";
import { useStore } from "../store";
import { atTime, hhmm, swissDay } from "../lib/format";
import { Chip, Header } from "../components/ui";
import { StopField } from "./CommuterSetup";
import type { BookedTrip, Stop, TicketKind } from "../types";

export const TICKET_LABEL: Record<TicketKind, string> = {
  supersaver: "Supersaver",
  point_to_point: "Normal ticket",
  travelcard: "Travelcard",
};

export default function BookingSetup() {
  const { back, saveBooking, showToast, status, clock } = useStore();
  const j = status?.journey;
  const [origin, setOrigin] = useState<Stop | null>(j?.origin ?? null);
  const [destination, setDestination] = useState<Stop | null>(j?.destination ?? null);
  const [day, setDay] = useState(swissDay(j?.departure ?? clock));
  const [time, setTime] = useState(j ? hhmm(j.departure) : hhmm(clock));
  const [ticket, setTicket] = useState<TicketKind>("supersaver");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!origin || !destination || !day || !time) return;
    setSaving(true);
    const booking: BookedTrip = {
      user_id: USER_ID,
      origin_stop_id: origin.id, destination_stop_id: destination.id,
      origin_name: origin.name, destination_name: destination.name,
      departure: atTime(day, time), ticket_kind: ticket,
    };
    try {
      const saved = await addBooking(booking);
      saveBooking(saved);
      showToast(saved.legs?.length
        ? `We watch your ${hhmm(saved.departure)} to ${saved.destination_name}`
        : "Saved, but this connection was not found in the timetable");
      back();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Header title="Booked trip" onBack={back} />
      <div className="content overlap">
        <p className="intro-card card">
          Already bought your ticket? We check your connections from 3 hours before departure,
          and warn you before you miss a change, even before the delay shows on the departure boards.
        </p>
        <section className="card form">
          <StopField label="From" value={origin} onChange={setOrigin} />
          <StopField label="To" value={destination} onChange={setDestination} />
          <div className="field-row">
            <label className="field">
              <span>Date</span>
              <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </label>
            <label className="field">
              <span>Departure</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          </div>
          <div className="field">
            <span>Ticket</span>
            <div className="chips">
              {(Object.keys(TICKET_LABEL) as TicketKind[]).map((k) => (
                <Chip key={k} active={ticket === k} onClick={() => setTicket(k)}>{TICKET_LABEL[k]}</Chip>
              ))}
            </div>
          </div>
        </section>

        <button className="btn btn-primary btn-lg" onClick={save}
          disabled={saving || !origin || !destination || origin.id === destination.id || !day || !time}>
          {saving ? "Saving…" : "Watch this trip"}
        </button>
      </div>
    </>
  );
}
