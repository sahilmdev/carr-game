# Nitro Cosmos: game plan

Agreed rules for the kart-style game. The current full race stays as it is, as the Grand Tour.

## Structure
- Menu: Grand Prix or Single Race, then car, then cup or track.
- Grand Prix: 4 cups of 4 races, 3 laps each. Trophies unlock the next cup.
- Single Race: any track, 1, 3 or 5 laps.
- Single player against 5 simulated rivals. No online play for now.
- Each race loads only its own assets. Set a size and detail limit per track.
- Fixed sky and lighting per track. Time and weather options are for the Grand Tour only.
- Laps of about 30-40 seconds.

## Driving rules
- No barriers by default. Walls only where the world needs them.
- Leaving the road is allowed. Off-road slows you, so cutting a corner is a trade.
- Solid things are solid: crash, then reverse out. Small things can break.
- Reverse is available. A wall behind the grid on lap 1 stops you driving off backwards.
- A fall returns you to the road near where you fell. No visible checkpoints.
- Laps are checked by hidden progress tracking, so they can't be cheated.
- Each lap should change something on the track.

## Edge kit
Choose every edge on purpose:

| Edge | Result |
|---|---|
| Soft ground | Slows you, can be cut across |
| Solid object | Crash and reverse out |
| Low rail | Scrape along it, a heavy hit can break through |
| Open drop | Fall, then rescue |
| Lower road | Land on another route and keep racing (the preferred fall-back) |
| Deadly surface | Instant rescue |
| Hard wall | Only where you must not go, such as an underwater glass tube |

## Rivals
- Each has a skill level, a personality and its own line, which changes by lap.
- They make mistakes, bump each other, try some shortcuts, fall and get rescued.
- They should not move as one group or always take the best route.

## Races
All 16 are confirmed: Cosmos Bay (strongly elevated road), Rainforest Run, Neon City, Deep Blue (far more scenery), Sky Islands, Ghost Galleon Bay, Gold Rush Line, Bobsleigh Peak, Mars Colony, Blossom Pass, Midnight Carnival, The Great Dam, Skyline Cranes, Solar Crown, Hollow Manor, and the Grand Tour as the finale.

## Items and nitro
- No items for now. After the game is done, think about adding them (future scope).
- Earned nitro on the new tracks: the tank starts empty and fills from drifts, jumps and clean landings. The Grand Tour keeps its current tank.

## Agreed details
- Commit a local save point before starting. No pushing.
- The test track is a plain grey-box circuit, for testing driving rules only.
- Crashes mostly bounce. A hard stop only for a head-on hit at speed.
- Rescue takes about 3 seconds.
- Grass cuts top speed by about 40%.
- The far edge of each world is mountains, sea or a drop, depending on the track.
- 5 rivals, with simple driver names and their own car and colour.
- Easy, Medium and Hard, chosen before a cup.
- Free realistic car models may be downloaded, stating each file and licence first.

## Cups
- Comet: Cosmos Bay, Rainforest Run, Blossom Pass, Neon City
- Nova: Deep Blue, Gold Rush Line, Bobsleigh Peak, Sky Islands
- Eclipse: Midnight Carnival, The Great Dam, Skyline Cranes, Mars Colony
- Supernova: Hollow Manor, Ghost Galleon Bay, Solar Crown, Grand Tour

## Build order
1. One-track loading, using a small test track.
2. Free driving on it: off-road, solid objects, reverse, falling and rescue.
3. Rival cars.
4. Better cars: fix the wheels, improve the models, make the Stiletto V12 the fastest.
5. The real tracks.
