"""Prevention: warn travellers *before* a delay happens.

- reliability.py  idea 3: reliability gauge of an itinerary from the usual road
                  traffic at that hour (rush hours); ranks longer but safer trips first.
- bus_delay.py    idea 4: future delay of a bus from the traffic it is about to
                  drive through *right now* (TomTom live traffic).
- bookings.py     idea 2: watch trips paid in advance and warn when a connection
                  is at risk (uses 3 and 4, plus the live incidents).

Frontend integration notes: docs/prevention-frontend-handoff.md
"""
