"""Quote register: quotes in, and a won quote straight into a job.

Replaces the Excel sales register. Not connected to Sage: invoices are raised
there from the job's payment milestones.
"""

import frappe
from frappe import _
from frappe.utils import add_days, getdate, today

from nest_projects.jobs import DRAWING_GATE, QC_GATE, default_company, ensure_customer

EDITABLE = ("customer_name", "description", "amount", "quote_date", "follow_up_on", "rep", "quote_file")

# The Order Face ticks, and the Customer Ready check each one becomes.
ORDER_FACE = [
	("packaging", "Packed, marked and tagged"),
	("delivery", "Delivery booked"),
	("installation", "Site ready for installation"),
	("safety_file", "Safety file issued"),
	("subcontractor", "Sub-contractor work signed off"),
]
ALWAYS_READY = "Customer confirmed ready for dispatch"

# Their payment terms: 20% on order, 30% on drawing approval, 50% on FAT.
PAYMENT_TERMS = [("On order", 20, "first"), ("On drawing approval", 30, DRAWING_GATE), ("On FAT", 50, QC_GATE)]

KEEP_DAYS = 180


@frappe.whitelist()
def get_quotes():
	"""Every open quote, plus won and lost ones from the last six months."""
	since = add_days(today(), -KEEP_DAYS)
	quotes = frappe.get_list(
		"Job Quote",
		fields=[
			"name", "quote_date", "customer_name", "description", "amount", "rep", "status",
			"follow_up_on", "lost_reason", "project", "won_on", "quote_file",
		],
		or_filters=[["status", "=", "Open"], ["quote_date", ">=", since], ["won_on", ">=", since]],
		order_by="quote_date desc, name desc",
		limit_page_length=0,
	)
	reps = {q.rep for q in quotes if q.rep}
	users = {
		u.name: {"full_name": u.full_name or u.name, "image": u.user_image}
		for u in frappe.get_all("User", filters={"name": ["in", list(reps)]}, fields=["name", "full_name", "user_image"])
	} if reps else {}
	return {
		"quotes": quotes,
		"users": users,
		"today": today(),
		"currency": frappe.db.get_value("Company", default_company(), "default_currency"),
		"can_create": bool(frappe.has_permission("Job Quote", "create")),
	}


@frappe.whitelist()
def save_quote(values, name=None):
	"""New quote, or changes to an open one, from the board's quote dialog."""
	values = frappe.parse_json(values) if isinstance(values, str) else (values or {})
	if name:
		doc = frappe.get_doc("Job Quote", name)
		if doc.status != "Open":
			frappe.throw(_("{0} is {1}; only open quotes can be changed.").format(name, doc.status))
	else:
		doc = frappe.new_doc("Job Quote")
	for field in EDITABLE:
		if field in values:
			doc.set(field, values.get(field) or None)
	doc.save()
	return doc.name


@frappe.whitelist()
def mark_lost(name, reason=None):
	doc = frappe.get_doc("Job Quote", name)
	if doc.status != "Open":
		frappe.throw(_("{0} is already {1}.").format(name, doc.status))
	doc.status = "Lost"
	doc.lost_reason = (reason or "").strip() or None
	doc.save()


@frappe.whitelist()
def win_quote(name, po, due_date=None, title=None, includes=None):
	"""The order arrives: one step replaces the job file, the order face and the register update.

	Creates the job at the first stage with the quote's details, the payment
	milestones and a Customer Ready check for every Order Face tick.
	"""
	quote = frappe.get_doc("Job Quote", name)
	quote.check_permission("write")
	if quote.status == "Won" and quote.project:
		frappe.throw(_("{0} is already won: {1}.").format(name, quote.project))
	po = (po or "").strip()
	if not po:
		frappe.throw(_("Enter the customer's PO number."))
	includes = frappe.parse_json(includes) if isinstance(includes, str) else (includes or [])

	stages = frappe.get_all("Job Stage", fields=["name", "gate", "default_owner", "is_closed"], order_by="sequence asc")
	first = next((s for s in stages if not s.is_closed), None)
	if not first:
		frappe.throw(_("Set up the Job Stages first."))
	customer = quote.customer or ensure_customer(quote.customer_name)

	job = frappe.new_doc("Project")
	job.update(
		{
			"project_name": (title or quote.description or quote.customer_name).strip().split("\n")[0][:140],
			"customer": customer,
			"company": default_company(),
			"status": "Open",
			"expected_start_date": today(),
			"expected_end_date": getdate(due_date) if due_date else None,
			"notes": quote.description,
			"job_stage": first.name,
			"job_owner": first.default_owner,
			"job_work_status": "Queued",
			"job_quote_ref": quote.name,
			"job_customer_po": po,
		}
	)
	for label, percent, due_at in PAYMENT_TERMS:
		stage = first if due_at == "first" else next((s for s in stages if s.gate == due_at), None)
		if stage:
			job.append("job_milestones", {"label": label, "percent": percent, "due_at_stage": stage.name})
	for key, check in ORDER_FACE:
		if key in includes:
			job.append("job_ready_checks", {"check": check})
	job.append("job_ready_checks", {"check": ALWAYS_READY})
	job.flags.job_move_note = _("Order {0} received against {1}").format(po, quote.name)
	job.insert()

	quote.status = "Won"
	quote.customer = customer
	quote.project = job.name
	quote.won_on = today()
	quote.follow_up_on = None
	quote.save()
	return job.name
