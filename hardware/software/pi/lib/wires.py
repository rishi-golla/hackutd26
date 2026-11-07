"""Logic for identifying the six unlabelled wires of the MARK button.

The wires are: two switch wires, the LED ring's common (+), and the red,
green and blue cathodes. Only two probes are used:

    + probe: pin 17 (3.3 V) -> 220 ohm resistor -> loose end
    - probe: pin 9 (GND)    -> loose end

With + on the common anode and - on a cathode, that colour lights at a few
mA. Every other pairing is either reverse-biased (dark), two LEDs back to
back (dark), or the switch (dark unless pressed, then 15 mA through the
resistor). So no probe position can short anything.

Plan:
  1. Hold - on one wire and touch + to each other wire. If that wire is a
     cathode, exactly one of the others (the common +) lights it. If nothing
     lights, move - to the next wire. At most 3 wires are not cathodes, so
     this finishes by the 4th round.
  2. Hold + on the common and touch - to each remaining wire: two light
     (the other two colours), two stay dark (the switch).
  If step 2 lights nothing, the ring is common CATHODE (the opposite of the
  listing); that is detected and reported with its own mapping.

`identify(labels)` is a generator: it yields probe positions (plus, minus)
and is sent back the colour seen ("red", "green", "blue" or "none"). Its
return value (StopIteration.value) is the result dict.
"""

from __future__ import annotations

COLOURS = ("red", "green", "blue")
NONE = "none"


class WireError(Exception):
    pass


def identify(labels):
    labels = list(labels)
    if len(labels) != 6 or len(set(labels)) != 6:
        raise WireError("need exactly six different wire names")

    # Step 1: find a cathode and the common anode.
    anode = first_cathode = first_colour = None
    for minus in labels:
        for plus in labels:
            if plus == minus:
                continue
            seen = yield (plus, minus)
            if seen != NONE:
                anode, first_cathode, first_colour = plus, minus, seen
                break
        if anode is not None:
            break
    if anode is None:
        raise WireError("No probe position lit the ring. Check both probes make contact, "
                        "that the + probe really goes through the resistor to pin 17, and "
                        "look again with the button shaded (green/blue are dim).")

    mapping = {"common": anode, first_colour: first_cathode}
    rest = [w for w in labels if w not in (anode, first_cathode)]

    # Step 2: + on the common, - on each remaining wire.
    dark = []
    for w in rest:
        seen = yield (anode, w)
        if seen == NONE:
            dark.append(w)
        elif seen in mapping:
            raise WireError(f"{seen} lit twice (wires {mapping[seen]} and {w}). "
                            "Re-check the probe contacts and start again.")
        else:
            mapping[seen] = w

    if len(dark) == 2 and all(c in mapping for c in COLOURS):
        return {"polarity": "common anode", **mapping, "switch": tuple(dark)}

    if len(dark) == 4:
        # Nothing lit with + held on `anode`: the ring is common cathode.
        # `first_cathode` is the shared cathode and `anode` is one colour's anode.
        mapping = {"common": first_cathode, first_colour: anode}
        dark = []
        for w in rest:
            seen = yield (w, first_cathode)
            if seen == NONE:
                dark.append(w)
            elif seen in mapping:
                raise WireError(f"{seen} lit twice. Re-check the probe contacts and start again.")
            else:
                mapping[seen] = w
        if len(dark) == 2 and all(c in mapping for c in COLOURS):
            return {"polarity": "common cathode", **mapping, "switch": tuple(dark)}

    raise WireError("The answers don't fit a 6-wire RGB ring + switch. Re-check the probe "
                    "contacts (and that the button is not pressed) and start again.")


def simulate_answer(truth, plus, minus):
    """What a real button would show for a probe position (used by tests).

    `truth` maps each wire label to a role: 'common', 'red', 'green',
    'blue', 'sw'; plus truth['_polarity'] = 'anode' or 'cathode'.
    """
    a, b = truth[plus], truth[minus]
    if truth.get("_polarity", "anode") == "anode":
        return b if a == "common" and b in COLOURS else NONE
    return a if b == "common" and a in COLOURS else NONE
