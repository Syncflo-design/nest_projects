"""What the Nest Assistant can look up about jobs. Read only.

Declared in hooks.py (nest_assistant_tools, nest_assistant_workload). On a site
without nest_assistant nothing here is ever called, and nothing here imports it.
Everything runs as the person asking: frappe.get_list decides which jobs they see.
"""

import frappe
from frappe.utils import add_days, date_diff, getdate, strip_html, today

from nest_projects.jobs import gate_failure

MAX_JOBS = 5
SEARCH_FIELDS = ["name", "project_name", "customer", "job_customer_po", "job_quote_ref", "job_site"]


def tools():
	return [
		{
			"name": "find_job",
			"doctype": "Project",
			"description": (
				"Find jobs on the job board by job number, customer, title, customer PO, quote "
				"number or site, and get where each one is: the stage as 'x of y', who has it "
				"and since when, whether they've started, what's holding it up, why it can't "
				"move on yet, materials, drawings, checks, due date, the last move, latest "
				"notes and open tasks. Use this first for any question about a job. Use short "
				"search terms - a job number or one name."
			),
			"input_schema": {
				"type": "object",
				"properties": {
					"search": {"type": "string", "description": "Job number, customer, title word, PO, quote or site."},
					"include_finished": {"type": "boolean", "description": "Also look at jobs in the final (closed) stage."},
				},
				"required": ["search"],
			},
			"method": "nest_projects.assistant.find_job",
		}
	]


def find_job(search, include_finished=False):
	stages = board_stages()
	filters = [["job_stage", "is", "set"], ["status", "!=", "Cancelled"]]
	closed = [s.name for s in stages if s.is_closed]
	if closed and not include_finished:
		filters.append(["job_stage", "not in", closed])
	search = (search or "").strip()
	names = frappe.get_list(
		"Project",
		filters=filters,
		or_filters=[[f, "like", f"%{search}%"] for f in SEARCH_FIELDS] if search else None,
		pluck="name",
		order_by="modified desc",
		limit=MAX_JOBS,
	)
	jobs = []
	for name in names:
		doc = frappe.get_doc("Project", name)
		doc.check_permission("read")
		jobs.append(job_facts(doc, stages))
	return {"found": len(jobs), "jobs": jobs}


def workload(user):
	"""The jobs a person holds, for 'what has Pieter got on?'."""
	open_stages = [s.name for s in board_stages() if not s.is_closed]
	if not open_stages:
		return {}
	jobs = frappe.get_list(
		"Project",
		filters=[["job_owner", "=", user], ["job_stage", "in", open_stages], ["status", "!=", "Cancelled"]],
		fields=["name", "project_name", "customer", "job_stage", "expected_end_date"],
		order_by="expected_end_date asc",
		limit=50,
	)
	week_end = add_days(today(), 6 - getdate(today()).weekday())
	due = [j for j in jobs if j.expected_end_date]
	return {
		"jobs held": len(jobs),
		"jobs due this week": sum(1 for j in due if getdate(today()) <= getdate(j.expected_end_date) <= getdate(week_end)),
		"jobs overdue": sum(1 for j in due if getdate(j.expected_end_date) < getdate(today())),
		"jobs": [
			f"{j.name} {j.customer or j.project_name} - {j.job_stage}" + (f", due {j.expected_end_date}" if j.expected_end_date else "")
			for j in jobs[:10]
		],
	}


def board_stages():
	return frappe.get_all("Job Stage", fields=["name", "sequence", "gate", "is_closed"], order_by="sequence asc")


def job_facts(doc, stages):
	names = [s.name for s in stages]
	here = names.index(doc.job_stage) if doc.job_stage in names else -1
	stage = stages[here] if here >= 0 else None
	next_stage = stages[here + 1] if stage and not stage.is_closed and here < len(stages) - 1 else None
	since = getdate(doc.job_stage_since) if doc.job_stage_since else None
	# The last handover; due date and priority changes (rows with an event) are not moves.
	last = next((row for row in reversed(doc.job_stage_log) if not row.get("event")), None)

	facts = {
		"job": doc.name,
		"title": doc.project_name,
		"customer": doc.customer,
		"site": doc.job_site,
		"stage": doc.job_stage,
		"stage position": f"{here + 1} of {len(stages)}" if stage else None,
		"with": user_name(doc.job_owner) or "nobody yet",
		"in this stage since": f"{since} ({date_diff(today(), since)} days)" if since else None,
		"started": "working on it" if doc.job_work_status == "In Progress" else "not started (queued)",
		"held up": ", ".join(filter(None, [doc.job_hold_reason, user_name(doc.job_waiting_on) and f"waiting on {user_name(doc.job_waiting_on)}", doc.job_blocker])) or None,
		"next action": doc.job_next_action,
		"next stage": next_stage.name if next_stage else None,
		"can't move on yet because": gate_failure(doc, stage.gate) if stage and stage.gate and next_stage else None,
		"due": str(doc.expected_end_date) if doc.expected_end_date else None,
		"overdue": "yes" if doc.expected_end_date and getdate(doc.expected_end_date) < getdate(today()) else None,
		"priority": doc.priority,
		"customer PO": doc.job_customer_po,
		"quote": doc.job_quote_ref,
		"materials": tally(doc.job_materials, "status"),
		"drawings": tally([d for d in doc.job_drawings if d.status != "Superseded"], "status"),
		"QC checks": ticked(doc.job_qc_checks),
		"customer ready checks": ticked(doc.job_ready_checks),
		"last move": (
			f"{last.from_stage or 'start'} to {last.to_stage} ({user_name(last.to_owner) or 'nobody'}) "
			f"by {user_name(last.moved_by)} on {getdate(last.moved_on)}" + (f": {last.note}" if last.note else "")
		)
		if last
		else None,
		"latest notes": [
			f"{getdate(c.creation)} {user_name(c.comment_email)}: {strip_html(c.content or '')[:300]}"
			for c in frappe.get_all(
				"Comment",
				filters={"reference_doctype": "Project", "reference_name": doc.name, "comment_type": "Comment"},
				fields=["creation", "comment_email", "content"],
				order_by="creation desc",
				limit=3,
			)
		],
		"open tasks": [
			f"{user_name(t.allocated_to)}: {strip_html(t.description or '')[:120]}" + (f" (due {t.date})" if t.date else "")
			for t in frappe.get_all(
				"ToDo",
				filters={"reference_type": "Project", "reference_name": doc.name, "status": "Open"},
				fields=["allocated_to", "description", "date"],
				order_by="creation desc",
				limit=5,
			)
		],
	}
	return {k: v for k, v in facts.items() if v not in (None, "", [], {})}


def tally(rows, field):
	"""'2 Received, 2 Ordered, 1 To Order (5)' - how far a list has got."""
	counts = {}
	for row in rows or []:
		counts[row.get(field) or "-"] = counts.get(row.get(field) or "-", 0) + 1
	if not counts:
		return None
	return ", ".join(f"{n} {status}" for status, n in counts.items()) + f" ({sum(counts.values())})"


def ticked(rows):
	return f"{sum(1 for r in rows if r.done)} of {len(rows)} done" if rows else None


def user_name(user):
	if not user:
		return ""
	return frappe.get_cached_value("User", user, "full_name") or user
