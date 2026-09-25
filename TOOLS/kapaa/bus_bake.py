"""Adds the bus route along Kuhio Hwy and the real Kauai Bus stop names to out/town.json.
Route runs north (Kealia) -> south (Wailua): s grows southward. 400 (Hanalei -> Lihue) drives with s, 500 (Lihue -> Hanalei) against it.
Stop places come from map landmarks; stops with no landmark are placed by timetable interpolation (marked approx)."""
import json, math
T = json.load(open('out/town.json'))
hw = [r['p'] for r in T['roads'] if r['k'] == 'primary']
segs = [p for p in hw if math.dist(p[0], p[-1]) > 1]               # drop the roundabout loop
start = max((p for p in segs), key=lambda p: -min(p[0][1], p[-1][1]))
cur = start if start[0][1] < start[-1][1] else start[::-1]; route = list(cur); used = {id(start)}
while True:
    end = route[-1]; best = None
    for p in segs:
        if id(p) in used: continue
        for q in (p, p[::-1]):
            d = math.dist(end, q[0])
            if d < 45 and q[-1][1] > end[1] - 5 and (best is None or d < best[0]): best = (d, q, p)
    if not best: break
    used.add(id(best[2])); route += best[1][1:] if best[0] < .5 else best[1]
# resample every 4 m and smooth lightly
res = [route[0]]; acc = 0
for a, b in zip(route, route[1:]):
    L = math.dist(a, b); t = 0
    while acc + (L - t) >= 4:
        t += 4 - acc; acc = 0; res.append([a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L])
    acc += L - t
for it in range(3):
    res = [res[0]] + [[(res[i-1][0] + 2*res[i][0] + res[i+1][0]) / 4, (res[i-1][1] + 2*res[i][1] + res[i+1][1]) / 4] for i in range(1, len(res) - 1)] + [res[-1]]
S = [0]
for a, b in zip(res, res[1:]): S.append(S[-1] + math.dist(a, b))
def proj(x, z):
    bi = min(range(len(res)), key=lambda i: (res[i][0] - x) ** 2 + (res[i][1] - z) ** 2); return S[bi], math.dist(res[bi], (x, z))
print('route', len(res), 'pts', round(S[-1]), 'm; starts', [round(v) for v in res[0]], 'ends', [round(v) for v in res[-1]])
L = lambda n: next(p for p in T['pois'] if p['n'] == n)
K = {}
K['Across Kealia Beach'] = proj(1410, -2796)[0]
K['Kapaa Neighborhood Center'] = proj(625, -575)[0]                  # Kou St, north end of old Kapaa
K['Kapaa Library'] = proj(L('Kapaa Library')['x'], L('Kapaa Library')['z'])[0]
K['Pono Kai'] = proj(162, 270)[0]
K['Kapaa Big Save'] = proj(-20, 678)[0]
K['Kuhio Hwy / Hoi Rd'] = proj(-110, 1240)[0]
K['Waipouli Beach Resort'] = proj(13, 1568)[0]
K['Kuhio Hwy / Haleilio Rd'] = proj(-1416, 2573)[0]
approx = set()
K['Kapaa Skate Park'] = (K['Pono Kai'] + K['Kapaa Library']) / 2; approx.add('Kapaa Skate Park')                 # 500: Pono Kai +34, Skate Park +37, Library +40
K['Kapaa Hongwanji'] = K['Waipouli Beach Resort'] + (K['Pono Kai'] - K['Waipouli Beach Resort']) * -3 / -4 * 1; approx.add('Kapaa Hongwanji')  # +30 .. +33 .. +34
K['Waipouli Courtyards'] = K['Waipouli Beach Resort'] + (K['Waipouli Beach Resort'] - K['Kapaa Hongwanji']); approx.add('Waipouli Courtyards')  # 3 min before the resort
for n, s in sorted(K.items(), key=lambda kv: kv[1]): print(f'{n:28s} s={s:7.0f}' + (' (approx)' if n in approx else ''))
T['bus'] = {'route': [[round(x, 1), round(z, 1)] for x, z in res], 'stops': {n: round(s, 1) for n, s in K.items()}, 'approx': sorted(approx)}
json.dump(T, open('out/town.json', 'w'), separators=(',', ':'))
