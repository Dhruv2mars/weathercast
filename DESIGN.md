# Weathercast Design System

## Intent

Weathercast is used during small moments of uncertainty: at a doorway, on a platform, before a ride, or while planning the next hour. The interface should feel like a precise instrument that remains calm in poor weather and legible in bright daylight.

## Color

Restrained strategy. Neutral system surfaces carry most screens. A deep cobalt-blue tint marks interaction and trustworthy data. Rain states progress from clear blue to cyan, indigo, and magenta only where intensity requires distinction. Warning colors are reserved for severe rain and errors.

Light tokens: background `#F7F9FC`, surface `#FFFFFF`, elevated `#EDF2F8`, ink `#0B1526`, muted ink `#4B5B70`, accent `#1768E5`, accent soft `#DCE9FF`, rain `#2089D8`, heavy rain `#6B4CE6`, destructive `#B42318`, success `#16794A`.

Dark tokens: background `#07101D`, surface `#101C2C`, elevated `#17263A`, ink `#F5F8FC`, muted ink `#AAB9CC`, accent `#72A7FF`, accent soft `#18365F`, rain `#5CB6EF`, heavy rain `#A78BFA`, destructive `#FF8A82`, success `#58C892`.

## Typography

Use the native system family. Map text to platform roles rather than decorative display styles. Rain timing and countdowns use tabular numbers. Maintain font scaling and avoid fixed-height text containers.

## Shape and Layout

Use 8 pt spacing rhythm. Major surfaces use 14–16 pt continuous corners. Pills are reserved for compact status labels and controls. Avoid nested cards: the primary nowcast is a single open composition; supporting evidence uses separators or one grouped surface. Content width caps at 720 pt on large screens.

## Motion

Motion explains state changes only. Press feedback scales to 0.98 in 120 ms. Forecast updates crossfade in 180–220 ms. Radar frames may animate linearly under direct user control. Honor Reduce Motion with crossfades or instant changes. No decorative page-load choreography.

## Native Adaptation

iOS uses large stack titles, system sheets, context menus, SF Symbols, 44 pt targets, semantic safe areas, and native back gestures. Android uses Material roles, predictive back, edge-to-edge insets, 48 dp targets, Material symbols, and snackbar-style transient feedback. Bottom navigation contains four destinations on compact screens.

## Components

- Nowcast verdict: one direct sentence, timing range, confidence, freshness, and data tier.
- Rain timeline: 15-minute bars with intensity, accessible labels, current-time marker, and a text alternative.
- Confidence row: plain label plus explanation; never a decorative score gauge.
- Location control: current or saved place, explicit permission and stale-location states.
- Data provenance: provider, issued time, and limitations available without cluttering the verdict.
- Empty, loading, offline, permission-denied, provider-error, and stale-data states are first-class.
