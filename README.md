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

## Job Board (`/app/job-board`)

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
- On phones the board shows one column per screen with chips to jump.
- Refreshes itself when any Project changes, and every minute.

## Demo data

On an empty board a System Manager sees **Load demo jobs**. It creates eleven
anonymised engineer-to-order jobs (JOB-345 to JOB-355) for "Acme Engineering",
six people (`@acme-demo.test`, Projects User, no password, email alerts off),
the customers, drawings with generated A3 GA sheets, materials, FAT checks,
20/30/50 payment milestones and back-dated stage history. All dates are
relative to the day it's loaded. New projects then continue as JOB-356.
The broom button on the toolbar removes it all again.

Needs the eight default stages and a Company.

### Demo script (about 5 minutes)

1. **By Person** — Rick's table: Paul is on JOB-350, next JOB-351; Jason is
   on JOB-348 (overdue, held up on a material spec), next JOB-352; Carla is on
   JOB-354, next JOB-355.
2. **Held Up / Overdue / Due 7 Days tiles** — one tap each.
3. **By Stage** — JOB-350 sits in Drawing Approval, held up awaiting the
   customer. Drag it to Procurement: it is **refused** because no drawing is
   approved. Control without admin.
4. Open JOB-350 → Job tab → Drawings: set Rev B to **Approved**, save. (Open
   the attached drawing to show the GA sheet.)
5. Back on the board, drag JOB-350 to Procurement. Thandi is already filled
   in; add a note; Hand Over. The blocker clears, **Invoice 30%** appears,
   Thandi gets an alert, Stage History records it. Nothing typed twice.
6. JOB-353 in QC / FAT shows QC 4/6; it can't be released until all checks are done.
7. New Project → it is numbered JOB-356; give it a stage and it is on the board.
8. On a phone: same board, one stage per screen, arrow to hand over.
