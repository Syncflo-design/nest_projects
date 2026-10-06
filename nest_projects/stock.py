"""Goods to and from a job's site store, and what is used there.

Every job gets its own site store (a warehouse under "Job Sites"). Goods move
from any store to it, or back, as a Material Transfer tagged to the job; what is
used on site is a Material Issue from it, which is what costs the job. Goods in
transit and vans are a separate app; this is the basic "from X to site" flow
every kind of job needs.
"""

import frappe
from frappe import _
from frappe.utils import flt

GROUP = "Job Sites"


def ensure_job_store(doc, method=None):
	"""Project on_update: a job on the board gets its own site store."""
	if not doc.job_stage or doc.job_warehouse or not doc.company:
		return
	doc.db_set("job_warehouse", site_store(doc), update_modified=False)


def site_store(job):
	"""The job's store, created under the company's Job Sites group (reused if it already exists)."""
	abbr = frappe.get_cached_value("Company", job.company, "abbr")
	label = " ".join(filter(None, [job.name, job.job_site]))[:100]
	name = f"{label} - {abbr}"
	if frappe.db.exists("Warehouse", name):
		if frappe.db.get_value("Warehouse", name, "disabled"):
			frappe.db.set_value("Warehouse", name, "disabled", 0)
		return name
	return (
		frappe.get_doc(
			{
				"doctype": "Warehouse",
				"warehouse_name": label,
				"company": job.company,
				"parent_warehouse": job_sites_group(job.company, abbr),
			}
		)
		.insert(ignore_permissions=True)
		.name
	)


def job_sites_group(company, abbr):
	name = f"{GROUP} - {abbr}"
	if frappe.db.exists("Warehouse", name):
		return name
	root = frappe.db.get_value("Warehouse", {"company": company, "is_group": 1, "parent_warehouse": ["is", "not set"]}, "name")
	return (
		frappe.get_doc(
			{"doctype": "Warehouse", "warehouse_name": GROUP, "company": company, "is_group": 1, "parent_warehouse": root}
		)
		.insert(ignore_permissions=True)
		.name
	)


def move_goods(job, from_warehouse, to_warehouse, lines, note=None):
	"""Goods from one store to another for this job, e.g. main store to site or site back to store."""
	if not from_warehouse or not to_warehouse:
		frappe.throw(_("Choose where the goods come from and where they go."))
	if from_warehouse == to_warehouse:
		frappe.throw(_("From and to must be different stores."))
	rows = clean(lines)
	entry = new_entry(job, "Material Transfer", note)
	for line in rows:
		entry.append(
			"items",
			{
				"item_code": line["item"],
				"qty": flt(line["qty"]),
				"s_warehouse": from_warehouse,
				"t_warehouse": to_warehouse,
				"project": job.name,
			},
		)
	return post(entry)


def use_on_site(job, lines, note=None, warehouse=None):
	"""What was used at site: issued from the site store against the job, so it costs the job."""
	warehouse = warehouse or job.job_warehouse
	if not warehouse:
		frappe.throw(_("{0} has no site store yet.").format(job.name))
	rows = clean(lines)
	entry = new_entry(job, "Material Issue", note)
	for line in rows:
		entry.append(
			"items",
			{"item_code": line["item"], "qty": flt(line["qty"]), "s_warehouse": warehouse, "project": job.name},
		)
	return post(entry)


def on_site(job):
	"""What is at the job's site store now."""
	if not job.job_warehouse:
		return []
	bins = frappe.get_all(
		"Bin",
		filters={"warehouse": job.job_warehouse, "actual_qty": [">", 0]},
		fields=["item_code", "actual_qty", "stock_value"],
		order_by="item_code asc",
	)
	names = dict(
		frappe.get_all("Item", filters={"name": ["in", [b.item_code for b in bins]]}, fields=["name", "item_name"], as_list=True)
	) if bins else {}
	return [
		{"item": b.item_code, "item_name": names.get(b.item_code) or b.item_code, "qty": b.actual_qty, "value": b.stock_value}
		for b in bins
	]


def clean(lines):
	rows = [line for line in (lines or []) if line.get("item") and flt(line.get("qty")) > 0]
	if not rows:
		frappe.throw(_("Add at least one item with a quantity."))
	return rows


def new_entry(job, purpose, note):
	entry = frappe.new_doc("Stock Entry")
	entry.stock_entry_type = purpose
	entry.company = job.company
	entry.project = job.name
	entry.remarks = note or _("{0} for {1}").format(_(purpose), job.name)
	return entry


def post(entry):
	# Anyone working the job may move its goods; ERPNext still refuses stock that isn't there.
	entry.flags.ignore_permissions = True
	entry.insert()
	entry.submit()
	return entry.name
