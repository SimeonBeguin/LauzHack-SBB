// Register a regular trip to get push alerts (incl. when an earlier train on the same line is hit).
import { useState } from "react";
import { registerCommuterTrip } from "../api/client";

export default function CommuterSetup({ onDone }: { onDone: () => void }) {
  const [origin, setOrigin] = useState("8501120");
  const [destination, setDestination] = useState("8504100");
  const [time, setTime] = useState("07:42");

  async function save() {
    // TODO: ask for Notification permission + register a push token (service worker)
    await registerCommuterTrip({
      user_id: "demo-user", origin_stop_id: origin, destination_stop_id: destination,
      departure_time: time, weekdays: [0, 1, 2, 3, 4],
    });
    onDone();
  }

  return (
    <div className="card">
      <h3>My regular trip</h3>
      {/* TODO: stop search instead of raw ids */}
      <input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="From (stop id)" />
      <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="To (stop id)" />
      <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      <button onClick={save}>Notify me about disruptions</button>
    </div>
  );
}
