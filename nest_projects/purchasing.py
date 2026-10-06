"""Purchase requests from a job, and the job's materials following their purchase order.

A PO request is a draft ERPNext Purchase Order linked to the job (header and
every line). The job's material lines then track it: Requested while the PO is
a draft, Ordered once it is submitted, Received when goods are received, and
back to To Order if the PO is cancelled or deleted. Approval tiers come later
(nest_po_management works on any purchase order, whatever created it).
"""

import frappe
from frappe import _
from frappe.utils import add_days, flt, getdate, today


def create_po_request(job, supplier, lines, schedule_date=None, warehouse=None):
	"""Draft PO for the given lines. Each line: item, qty, optional description and the job material row.

	warehouse is where the goods are to be received: the job's site store unless another is chosen.
	It goes on every line, and the goods receipt takes it from there.
	"""
	if not supplier:
		frappe.throw(_("Choose the supplier."))
	lines = [line for line in lines if line.get("item") and flt(line.get("qty")) > 0]
	if not lines:
		frappe.throw(_("Add at least one item with a quantity."))
	schedule_date = getdate(schedule_date) if schedule_date else getdate(add_days(today(), 14))
	if schedule_date < getdate(today()):
		frappe.throw(_("Required by can't be in the past."))

	warehouse = warehouse or job.get("job_warehouse") or default_warehouse(job.company)
	if frappe.db.get_value("Warehouse", warehouse, "company") != job.company:
		frappe.throw(_("{0} belongs to another company.").format(warehouse))
	po = frappe.new_doc("Purchase Order")
	po.update(
		{
			"supplier": supplier,
			"company": job.company,
			"project": job.name,
			"transaction_date": today(),
			"schedule_date": schedule_date,
			"set_warehouse": warehouse,
		}
	)
	for line in lines:
		row = {
			"item_code": line["item"],
			"qty": flt(line["qty"]),
			"schedule_date": schedule_date,
			"project": job.name,
			"warehouse": warehouse,
		}
		if (line.get("description") or "").strip():
			row["description"] = line["description"].strip()
		rate = buying_rate(line["item"])
		if rate:
			row["rate"] = rate
		po.append("items", row)
	# A request is a draft: anyone working the job may raise one; submitting it stays with buying.
	po.flags.ignore_permissions = True
	po.insert()

	# The job's materials record what was requested, adding anything that wasn't on the list.
	existing = {row.name: row for row in job.get("job_materials") or []}
	for line in lines:
		row = existing.get(line.get("row"))
		if row:
			row.item = line["item"]
			row.qty = flt(line["qty"])
		else:
			row = job.append(
				"job_materials",
				{
					"item": line["item"],
					"description": (line.get("description") or "").strip()
					or frappe.db.get_value("Item", line["item"], "item_name"),
					"qty": flt(line["qty"]),
				},
			)
		row.status = "Requested"
		row.purchase_order = po.name
		row.expected_on = schedule_date
	return po.name


def default_warehouse(company):
	"""The stock default if it belongs to the job's company, else that company's Stores, else any of its warehouses."""
	warehouse = frappe.db.get_single_value("Stock Settings", "default_warehouse")
	if warehouse and frappe.db.get_value("Warehouse", warehouse, "company") == company:
		return warehouse
	active = {"company": company, "is_group": 0, "disabled": 0}
	return frappe.db.get_value("Warehouse", {**active, "warehouse_name": "Stores"}, "name") or frappe.db.get_value(
		"Warehouse", active, "name"
	)


def buying_rate(item):
	price_list = frappe.db.get_single_value("Buying Settings", "buying_price_list") or "Standard Buying"
	rate = frappe.db.get_value("Item Price", {"item_code": item, "price_list": price_list, "buying": 1}, "price_list_rate")
	return flt(rate) or flt(frappe.db.get_value("Item", item, "last_purchase_rate"))


def set_lines(purchase_order, status, items=None, clear=False):
	filters = {"purchase_order": purchase_order, "parenttype": "Project"}
	if items:
		filters["item"] = ["in", list(items)]
	for name in frappe.get_all("Job Material", filters=filters, pluck="name"):
		values = {"status": status}
		if clear:
			values["purchase_order"] = None
		frappe.db.set_value("Job Material", name, values, update_modified=False)


# ---- doc events -------------------------------------------------------------


def po_submitted(doc, method=None):
	set_lines(doc.name, "Ordered")


def po_released(doc, method=None):
	"""Cancelled or deleted: the lines are back to being needed."""
	set_lines(doc.name, "To Order", clear=True)


def receipt_submitted(doc, method=None):
	for po, items in received_by_po(doc).items():
		set_lines(po, "Received", items)


def receipt_cancelled(doc, method=None):
	for po, items in received_by_po(doc).items():
		set_lines(po, "Ordered", items)


def received_by_po(doc):
	by_po = {}
	for row in doc.get("items") or []:
		if row.purchase_order:
			by_po.setdefault(row.purchase_order, set()).add(row.item_code)
	return by_po
