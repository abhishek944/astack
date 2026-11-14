# Third-party notices

## t3code — schedule semantics

The schedule model and next-run behaviour in `src/core/schedule.ts` are adapted
from the MIT-licensed T3 Code scheduler:

- `apps/server/src/scheduledTasks/Schedule.ts` — interval and fixed-time next
  run computation, the ten minute missed-run grace, schedule equality.
- `packages/contracts/src/scheduledTask.ts` — the interval / fixed-time union,
  weekday encoding (`0` is Sunday, omitted means daily), and the interval floor
  that this package deliberately does **not** port.

What was adapted: the shape of the schedule union, weekday normalisation as a
set, `nextFixedRunAt` / `nextRunAt` semantics, `isMissedFixedRun`, and
`isSameSchedule`. The implementation here is independent TypeScript without
Effect, SQLite, cron or the T3 RPC layer. The runtime architecture (5 second
tick and dispatch guard released at dispatch acceptance) is behaviourally
modelled on the same service. Unlike that service, this mod cannot prove an
interrupted owner's death and does not automatically recover/replay runs.

```
MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
