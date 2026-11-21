import type { Alternative } from "../types";

export default function AlternativeCard({ alternative }: { alternative: Alternative }) {
  // TODO: show legs, transfers, distance to destination, road delay for buses
  return (
    <div className="card">
      <div>Arrival {new Date(alternative.arrival).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} at {alternative.final_stop.name}</div>
      <small>{alternative.transfers} transfer(s){alternative.ticket_hint ? ` · ${alternative.ticket_hint}` : ""}</small>
    </div>
  );
}
