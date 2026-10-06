# Nest Projects

Job board for engineer-to-order work. Every job is an ERPNext **Project**; this
app puts them all on one Kanban board, from order to customer ready, and makes
each handover between people visible.

Requires `erpnext` only. No client-specific settings are hardcoded.

## What it adds

- **Job Stage** — the board's columns, in order. Each stage can name who usually
  handles it, limit who can be picked by role, and set a gate the job must pass
  before it can leave (drawing approved / QC checks complete). Eight default
  stages are seeded on a fresh site.
- **Job tab on Project** — stage, responsible person, progress (queued / in
  progress), quote no, customer PO, site, what it's held up by, plus tables for
  drawings (with revisions), materials, QC/FAT checks, payment milestones and
  the stage history.

Project's own customer, priority and expected end date (due date) are used as-is.

## Job Board (`/desk/job-board`)

- One column per stage; a Project appears once it has a stage.
- Cards show job no, customer, site, due date (amber within 7 days, red when
  overdue), what it's held up by, drawing revision, materials, QC progress,
  what's ready to invoice, the responsible person and time in the stage.
- Stat tiles in the header are the filters: active, with me, held up, overdue,
  due in 7 days, to invoice. Search covers job, customer, site and person.
- **Handover:** drag a card to another column (desktop) or tap its arrow
  (phone). One dialog asks who takes it, prefilled from the stage, plus an
  optional note. The new person gets an alert; the move goes in Stage History.
- **Gates:** a job can't move forward past a stage whose gate isn't met. Moving
  back is always allowed. The same rules apply when the stage is changed on the
  Project form.
- **By Person view** (toggle next to search, remembered per browser): one
  column per person, "On it now" then "Next up" by priority and due date, each
  card tagged with its stage; held-up and overdue counts in each header; an
  Unassigned column. Stage regulars show even when idle. Dragging a card to
  another person reassigns it (alert + history row).
- Tapping a card's Queued / On it pill flips what the person is working on now.
- **Fits the screen:** columns share the width (the board only scrolls below
  a minimum column width). Empty columns and the finished stage fold to a slim
  strip with a count; click to open, or fold any column from its header.
  Narrow columns show compact cards (tags on hover and in the panel). Folded
  strips still accept a dragged card.
- **Pick what to show:** the Stages button (By Stage) or People button (By
  Person) opens a tick-list, e.g. only the engineering stages, or only the
  engineers. Tiles count what is shown. Each is remembered per browser.
- On phones the board shows one column per screen with chips to jump.
- Refreshes itself when any Project changes, and every minute.

## Job panel

Tapping a card opens the job beside the board instead of the Project form:
responsible person (On it / Queued, Change), due date, quote and PO, what it's
held up by (Mark as held up / Sorted), drawings with revisions (Sent to client,
Client approved, New revision with upload; older revisions are superseded),
materials (tap to move To Order → Ordered → Received), QC / FAT checks and
Customer Ready checks (tap to tick; who and when is recorded), payment
milestones (Mark invoiced with the Sage invoice number) and the history.
The footer hands over or sends back, and says why when a gate blocks it.

## Quotes (the sales register)

The third view on the board replaces their Excel sales register. **Job Quote**
holds the basics only: customer (typed; a Customer record is made only when
won), description, value incl VAT, date, rep, follow-up date, status
(Open / Won / Lost, with a reason) and the quote document. Not connected to Sage.

- Tiles: open quotes, pipeline value, follow-ups due, won this month, lost,
  win rate over 90 days. Open quotes sort by follow-up date, most overdue first.
- **Won** asks for the PO number, due date and job title, plus the Order Face
  ticks (packaging, delivery, installation, safety file, sub-contractor). It
  creates the job at the first stage with the quote linked, the 20/30/50
  payment milestones, and one Customer Ready check per tick (plus "customer
  confirmed ready for dispatch"). The board then opens the new job.
- Stage gate **Ready checks complete** (Customer Ready by default) stops a job
  being released until those checks are ticked.

## Demo data

On an empty board a System Manager sees **Load demo jobs**. It creates eleven
anonymised engineer-to-order jobs (JOB-345 to JOB-355) for "Acme Engineering",
six people (`@acme-demo.test`, Projects User, no password, email alerts off),
the customers, drawings with generated A3 GA sheets, materials, FAT checks,
20/30/50 payment milestones and back-dated stage history. All dates are
relative to the day it's loaded. It also loads their August sales register
(26 quotes) plus the 11 quotes that became the jobs. New projects then
continue as JOB-356 and new quotes as AT1430.

The broom button removes the demo **and every job, quote and customer created
since it was loaded**, then resets the numbering, so: load, test, broom, and
load again live in front of the prospect.

Needs the eight default stages and a Company.

### Demo script (about 5 minutes)

0. **Load demo jobs** live on the empty board.
1. **Quotes** — their own register: pipeline, follow-ups due. Mark AT1420
   **Won**: PO, tick delivery and installation, Create Job → JOB-356 opens on
   the board with milestones and Customer Ready checks. Nothing retyped.
2. **By Person** — Rick's table: Paul is on JOB-350, next JOB-351; Jason is
   on JOB-348 (overdue, held up on a material spec), next JOB-352; Carla is on
   JOB-354, next JOB-355.
3. **Held Up / Overdue / Due 7 Days tiles** — one tap each.
4. **By Stage** — JOB-350 sits in Drawing Approval, held up awaiting the
   customer. Drag it to Procurement: it is **refused** because no drawing is
   approved. Control without admin.
5. Tap JOB-350: the panel shows the lock and why. Open Rev B (the eye) to
   show the GA sheet, then tap **Client approved** on it.
6. **Hand over to Procurement**: Thandi is already filled in; add a note.
   The blocker clears, **Invoice 30%** appears, Thandi gets an alert, the
   history records it. Nothing typed twice.
7. JOB-353 in QC / FAT shows QC 4/6; tick the last two in the panel and it
   can be released. JOB-346 in Customer Ready waits on its ready checks.
8. On a phone: same board, one stage per screen, tap a card for the panel.
