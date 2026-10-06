"""Demo jobs: an anonymised engineer-to-order workshop, loaded and removed from the board.

Every date is relative to the day it is loaded, so the board always looks like a
live working day: some jobs overdue, some due this week, one held up waiting on
the customer. JOB-350 is staged for the live handover (see README, Demo script).
"""

import frappe
from frappe import _
from frappe.custom.doctype.property_setter.property_setter import make_property_setter
from frappe.model.naming import NamingSeries
from frappe.desk.doctype.notification_settings.notification_settings import create_notification_settings
from frappe.utils import add_days, add_to_date, get_datetime, today

DOMAIN = "acme-demo.test"
SERIES = "JOB-.###"
LAST_DEMO_NO = 355

# key: (first name, last name, role in the story)
PEOPLE = {
	"paul": ("Paul", "Naidoo", "Engineer"),
	"jason": ("Jason", "Mokoena", "Engineer"),
	"carla": ("Carla", "Smit", "Engineer"),
	"thandi": ("Thandi", "Dlamini", "Buyer"),
	"werner": ("Werner", "Botha", "Workshop Foreman"),
	"sipho": ("Sipho", "Ndlovu", "QC Inspector"),
}

# Who usually handles each stage. Only filled where the stage has nobody yet.
STAGE_REGULARS = {
	"Order": "me",
	"Procurement": "thandi",
	"Production": "werner",
	"QC / FAT": "sipho",
	"Customer Ready": "me",
}

STANDARD_MILESTONES = [
	("On order", 20, "Order"),
	("On drawing approval", 30, "Drawing Approval"),
	("On FAT", 50, "QC / FAT"),
]

FAT_CHECKS = [
	"Dimensional check against GA drawing",
	"Shaft run-out within 0.05 mm",
	"Bearing temperature run (2 hours)",
	"Vibration below 4.5 mm/s",
	"Paint DFT 250 micron",
	"Nameplate, tagging and job marking",
]

# Each job: where it is, who has it, and the path it took (stage, person, days ago, note).
JOBS = [
	{
		"no": 345, "title": "Clear Water Access Ladders", "customer": "Boat Sne Investments",
		"site": "Clear Water Reservoir", "quote": "AT1403", "po": "BSI-0091", "due": -9,
		"owner": None, "no_drawing": 1, "qc_done": 3, "qc": FAT_CHECKS[:3],
		"milestones": [("On delivery", 100, "Customer Ready", "INV0000561")],
		"materials": [("Galvanised ladder sections", 4, "Received"), ("Fixing brackets", 16, "Received")],
		"path": [("Order", "me", 34), ("Engineering", "carla", 32), ("Procurement", "thandi", 28),
				 ("Production", "werner", 22), ("QC / FAT", "sipho", 14), ("Customer Ready", "me", 11),
				 ("Invoiced", None, 8, "Delivered and invoiced in Sage")],
		"scope": "Supply and install four galvanised access ladders with safety cages.",
	},
	{
		"no": 346, "title": "Kareeberg Hand Screen", "customer": "Ban Wrence", "site": "Kareeberg WWTW",
		"quote": "AT1417", "po": "BW-2214", "due": 1, "owner": "me", "no_drawing": 1,
		"qc": FAT_CHECKS[:5], "qc_done": 5,
		"milestones": [("On order", 50, "Order", "INV0000570"), ("On FAT", 50, "QC / FAT", None)],
		"materials": [("316 stainless bar screen", 1, "Received"), ("Rake and holder", 1, "Received"),
					  ("Anchor bolts M16", 8, "Received")],
		"path": [("Order", "me", 24), ("Engineering", "carla", 22), ("Procurement", "thandi", 19),
				 ("Production", "werner", 12), ("QC / FAT", "sipho", 6),
				 ("Customer Ready", "me", 2, "FAT passed. Ready for collection.")],
		"scope": "Manual bar screen, 316 stainless, 25 mm spacing, with rake.",
	},
	{
		"no": 347, "title": "Clarifier Bridge Refurbishment", "customer": "Wythe Municipal",
		"site": "Site Charlie", "quote": "AT1402", "po": "WM-55821", "due": 16, "owner": "werner",
		"working": 1,
		"drawings": [("GA-347-01", "A", "Clarifier bridge general arrangement", "Approved", 20)],
		"qc": FAT_CHECKS, "qc_done": 0,
		"milestones": [("On order", 20, "Order", "INV0000559"), ("On drawing approval", 30, "Drawing Approval", "INV0000566"),
					   ("On FAT", 50, "QC / FAT", None)],
		"materials": [("Bridge drive gearmotor", 1, "Received"), ("Scraper blades", 6, "Received"),
					  ("Walkway grating", 12, "Received"), ("Handrail kit", 1, "Received")],
		"path": [("Order", "me", 38), ("Engineering", "jason", 36), ("Drawing Approval", "jason", 26),
				 ("Procurement", "thandi", 20), ("Production", "werner", 9)],
		"scope": "Strip, blast and recoat bridge; replace drive and scraper blades.",
	},
	{
		"no": 348, "title": "Waterval Classifier Repairs", "customer": "Strangeing Mind", "site": "Waterval",
		"quote": "AT1429", "po": "PO-0216", "due": -4, "owner": "jason", "working": 1, "priority": "High",
		"blocker": "Client to confirm wear-plate material (Hardox 400 or 500)",
		"drawings": [("GA-348-01", "A", "Classifier repair general arrangement", "Draft", None)],
		"milestones": [("On order", 50, "Order", "INV0000568"), ("On delivery", 50, "Customer Ready", None)],
		"path": [("Order", "me", 27, "Order received. 50% deposit invoiced."), ("Engineering", "jason", 25)],
		"scope": "Repair classifier spiral and replace wear plates.",
	},
	{
		"no": 349, "title": "Twinsaver Screening Equipment", "customer": "Lumpspec Consultants",
		"site": "Twinsaver Mill", "quote": "AT1379", "po": "1667", "due": 6, "owner": "thandi", "working": 1,
		"drawings": [("GA-349-02", "B", "Screen general arrangement", "Superseded", None),
					 ("GA-349-02", "C", "Screen general arrangement", "Approved", 9)],
		"materials": [("316 stainless sheet 3 mm", 4, "In Stock"), ("Drive motor 2.2 kW IE3", 1, "Ordered"),
					  ("Gearbox SEW R47", 1, "To Order"), ("Wedge-wire screen panel", 2, "To Order"),
					  ("Bearings UCF210", 4, "In Stock"), ("Stainless fastener kit", 1, "To Order")],
		"milestones": [("On order", 20, "Order", "INV0000571"), ("On drawing approval", 30, "Drawing Approval", None),
					   ("On FAT", 50, "QC / FAT", None)],
		"path": [("Order", "me", 29), ("Engineering", "carla", 27), ("Drawing Approval", "carla", 15, "Rev B sent to client"),
				 ("Procurement", "thandi", 8, "Rev C approved by client")],
		"scope": "Wedge-wire screen with drive, frame and launder.",
	},
	{
		"no": 350, "title": "Phalaphala Aerators Refurbishment", "customer": "Lumpspec Consultants",
		"site": "Site Alpha", "quote": "QUOTE-1413", "po": "PO-1074", "due": 5, "owner": "paul", "working": 1,
		"priority": "High", "blocker": "Awaiting customer drawing approval (Rev B sent)",
		"drawings": [("GA-350-01", "A", "Aerator general arrangement", "Superseded", None),
					 ("GA-350-01", "B", "Aerator general arrangement", "Sent for Approval", None),
					 ("DT-350-02", "A", "Rotor shaft detail", "Draft", None)],
		"materials": [("Aerator gearbox overhaul kit", 4, "To Order"), ("Rotor shaft EN19 90 mm", 4, "To Order"),
					  ("Bearing set SKF 22220", 8, "In Stock"), ("Epoxy paint system 20 L", 3, "In Stock"),
					  ("Coupling Rex Omega E20", 4, "To Order")],
		"qc": FAT_CHECKS, "qc_done": 0,
		"milestones": [("On order", 20, "Order", "INV0000579"), ("On drawing approval", 30, "Drawing Approval", None),
					   ("On FAT", 50, "QC / FAT", None)],
		"path": [("Order", "me", 12, "PO-1074 received, linked to QUOTE-1413"), ("Engineering", "paul", 11),
				 ("Drawing Approval", "paul", 2, "Rev B sent to client for approval")],
		"scope": "Wastewater equipment refurbishment: overhaul four surface aerators, new rotor shafts and couplings.",
	},
	{
		"no": 351, "title": "Distell Screen in a Sump", "customer": "Lower Tech Processing", "site": "Distell Plant",
		"quote": "AT965 Rev4", "po": "LTP-3302", "due": 15, "owner": "paul",
		"drawings": [("GA-351-01", "A", "Sump screen general arrangement", "Draft", None)],
		"milestones": [("On order", 50, "Order", "INV0000575"), ("On delivery", 50, "Customer Ready", None)],
		"path": [("Order", "me", 8), ("Engineering", "paul", 7)],
		"scope": "Drum screen installed in an existing sump, with access platform.",
	},
	{
		"no": 352, "title": "Sluice Gates (x4)", "customer": "ERS Construction Group", "site": "Site Bravo",
		"quote": "AT1391", "po": "ERS-7781", "due": 40, "owner": "jason",
		"milestones": STANDARD_MILESTONES,
		"path": [("Order", "me", 1, "New order. Engineering to start after JOB-348.")],
		"scope": "Four 1.2 m x 1.2 m stainless sluice gates with handwheel operators.",
	},
	{
		"no": 353, "title": "Telescopic Valve", "customer": "Erdem Construction", "site": "All Saints WWTW",
		"quote": "AT1405", "po": "EC-1190", "due": 2, "owner": "sipho", "working": 1,
		"drawings": [("GA-353-01", "B", "Telescopic valve general arrangement", "Approved", 21)],
		"materials": [("Telescopic tube 316", 1, "Received"), ("Headstock and spindle", 1, "Received")],
		"qc": FAT_CHECKS, "qc_done": 4,
		"milestones": [("On order", 20, "Order", "INV0000560"), ("On drawing approval", 30, "Drawing Approval", "INV0000567"),
					   ("On FAT", 50, "QC / FAT", None)],
		"path": [("Order", "me", 30), ("Engineering", "jason", 28), ("Drawing Approval", "jason", 21),
				 ("Procurement", "thandi", 17), ("Production", "werner", 10), ("QC / FAT", "sipho", 1)],
		"scope": "Telescopic decant valve, 300 mm, with headstock.",
	},
	{
		"no": 354, "title": "Archimedes Screw Pump Bearings", "customer": "Websonga", "site": "Site Delta",
		"quote": "AT1394", "po": "WS-404", "due": 9, "owner": "carla", "working": 1,
		"drawings": [("DT-354-01", "A", "Bottom bearing housing detail", "Draft", None)],
		"milestones": STANDARD_MILESTONES,
		"path": [("Order", "me", 5), ("Engineering", "carla", 4)],
		"scope": "Replace bottom and top bearings on two Archimedes screw pumps.",
	},
	{
		"no": 355, "title": "Kat River Penstock Refurbishment", "customer": "Duwacona",
		"site": "Kat River Abstraction", "quote": "AT1389", "po": "DW-2290", "due": 28, "owner": "carla",
		"milestones": STANDARD_MILESTONES,
		"path": [("Order", "me", 3), ("Engineering", "carla", 3)],
		"scope": "Refurbish two penstocks: new seals, spindles and actuators.",
	},
]


@frappe.whitelist()
def load_demo():
	frappe.only_for("System Manager")
	if frappe.db.exists("Project", {"job_is_demo": 1}):
		frappe.throw(_("The demo jobs are already loaded. Remove them first."))
	needed = {step[0] for job in JOBS for step in job["path"]}
	missing = needed - set(frappe.get_all("Job Stage", pluck="name"))
	if missing:
		frappe.throw(_("The demo needs the default stages. Missing: {0}").format(", ".join(sorted(missing))))
	taken = [f"JOB-{j['no']}" for j in JOBS if frappe.db.exists("Project", f"JOB-{j['no']}")]
	if taken:
		frappe.throw(_("These projects already exist: {0}").format(", ".join(taken)))
	company = default_company()

	users = {"me": frappe.session.user}
	for key, (first, last, _role) in PEOPLE.items():
		users[key] = ensure_user(key, first, last)
	customers = {name: ensure_customer(name) for name in {j["customer"] for j in JOBS}}

	for stage, key in STAGE_REGULARS.items():
		if not frappe.db.get_value("Job Stage", stage, "default_owner"):
			frappe.db.set_value("Job Stage", stage, "default_owner", users[key])

	for job in JOBS:
		make_job(job, users, customers, company)

	use_job_numbers()
	return {"jobs": len(JOBS), "people": len(PEOPLE)}


@frappe.whitelist()
def remove_demo():
	frappe.only_for("System Manager")
	names = frappe.get_all("Project", filters={"job_is_demo": 1}, pluck="name")
	for name in names:
		frappe.delete_doc("Project", name, ignore_permissions=True, force=True)
	if names:
		frappe.db.delete("Notification Log", {"document_type": "Project", "document_name": ["in", names]})

	emails = [demo_email(key) for key in PEOPLE]
	for stage in frappe.get_all("Job Stage", filters={"default_owner": ["in", emails]}, pluck="name"):
		frappe.db.set_value("Job Stage", stage, "default_owner", None)

	kept = []
	for email in emails:
		if not frappe.db.exists("User", email):
			continue
		frappe.db.delete("Notification Log", {"for_user": email})
		frappe.db.delete("Notification Log", {"from_user": email})
		try:
			frappe.delete_doc("User", email, ignore_permissions=True)
		except frappe.LinkExistsError:
			# Something real now points at this person; keep them but switch them off.
			frappe.db.set_value("User", email, "enabled", 0)
			kept.append(email)

	for title in {j["customer"] for j in JOBS}:
		name = frappe.db.get_value("Customer", {"customer_name": title})
		if not name:
			continue
		try:
			frappe.delete_doc("Customer", name, ignore_permissions=True)
		except frappe.LinkExistsError:
			kept.append(name)
	return {"jobs": len(names), "kept": kept}


def make_job(job, users, customers, company):
	path = job["path"]
	start = add_days(today(), -path[0][2])
	stage, last_days = path[-1][0], path[-1][2]
	owner = users.get(job["owner"]) if job["owner"] else None

	doc = frappe.get_doc(
		{
			"doctype": "Project",
			"naming_series": "PROJ-.####",
			"project_name": job["title"],
			"customer": customers.get(job["customer"]),
			"company": company,
			"status": "Open",
			"priority": job.get("priority", "Medium"),
			"expected_start_date": start,
			"expected_end_date": max(add_days(today(), job["due"]), start),
			"notes": job.get("scope"),
			"job_is_demo": 1,
			"job_stage": stage,
			"job_owner": owner,
			"job_work_status": "In Progress" if job.get("working") else "Queued",
			"job_stage_since": stamp(last_days),
			"job_quote_ref": job["quote"],
			"job_customer_po": job["po"],
			"job_site": job.get("site"),
			"job_blocker": job.get("blocker"),
			"job_drawing_not_required": job.get("no_drawing", 0),
		}
	)
	for dwg_no, rev, title, status, approved_days in job.get("drawings", []):
		doc.append("job_drawings", {
			"drawing_no": dwg_no, "revision": rev, "title": title, "status": status,
			"approved_on": add_days(today(), -approved_days) if approved_days else None,
		})
	for description, qty, status in job.get("materials", []):
		doc.append("job_materials", {
			"description": description, "qty": qty, "status": status,
			"expected_on": add_days(today(), 3) if status == "Ordered" else None,
		})
	for i, check in enumerate(job.get("qc", [])):
		done = i < job.get("qc_done", 0)
		doc.append("job_qc_checks", {
			"check": check, "done": int(done),
			"done_by": users["sipho"] if done else None, "done_on": stamp(1) if done else None,
		})
	for row in job.get("milestones", []):
		label, percent, due_at = row[0], row[1], row[2]
		invoice = row[3] if len(row) > 3 else None
		doc.append("job_milestones", {
			"label": label, "percent": percent, "due_at_stage": due_at,
			"invoiced": int(bool(invoice)), "invoice_ref": invoice,
		})
	for i, step in enumerate(path):
		# Each move is made by whoever had the job before it (the office raises the order).
		handed_by = users.get(path[i - 1][1]) if i and path[i - 1][1] else users["me"]
		doc.append("job_stage_log", {
			"from_stage": path[i - 1][0] if i else None, "to_stage": step[0],
			"to_owner": users.get(step[1]) if step[1] else None,
			"moved_by": handed_by, "moved_on": stamp(step[2]),
			"note": step[3] if len(step) > 3 else None,
		})

	# History, stage dates and done-by are written above as they would have happened.
	doc.flags.job_demo_load = True
	doc.insert(ignore_permissions=True, set_name=f"JOB-{job['no']}")

	# Drawings are credited to whoever had the job in Engineering.
	engineer = next((users.get(step[1]) for step in path if step[0] == "Engineering" and step[1]), users["me"])
	for row in doc.job_drawings:
		url = save_drawing(doc, row, engineer)
		frappe.db.set_value("Job Drawing", row.name, "file", url, update_modified=False)


def save_drawing(project, row, drawn_by):
	svg = drawing_svg(project, row, frappe.db.get_value("User", drawn_by, "full_name") or "Engineering")
	file = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": f"{row.drawing_no}-Rev{row.revision}.svg",
			"attached_to_doctype": "Project",
			"attached_to_name": project.name,
			"is_private": 1,
			"content": svg.encode("utf-8"),
		}
	).insert(ignore_permissions=True)
	return file.file_url


def drawing_svg(project, row, drawn_by):
	"""A plausible A3 general-arrangement sheet with a real title block."""
	esc = frappe.utils.escape_html
	status = "FOR APPROVAL" if row.status == "Sent for Approval" else row.status.upper()
	stamp_colour = {"APPROVED": "#16a34a", "FOR APPROVAL": "#d97706", "SUPERSEDED": "#dc2626"}.get(status, "#64748b")
	return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1190 842" font-family="Arial, Helvetica, sans-serif">
<rect width="1190" height="842" fill="#ffffff"/>
<rect x="20" y="20" width="1150" height="802" fill="none" stroke="#1f2937" stroke-width="3"/>
<rect x="34" y="34" width="1122" height="774" fill="none" stroke="#1f2937" stroke-width="1"/>
<g stroke="#1e3a8a" stroke-width="2" fill="none">
 <rect x="120" y="300" width="560" height="260" rx="8"/>
 <line x1="120" y1="360" x2="680" y2="360" stroke-dasharray="14 8"/>
 <line x1="400" y1="120" x2="400" y2="470"/>
 <rect x="350" y="110" width="100" height="70" rx="6"/>
 <rect x="372" y="180" width="56" height="40"/>
 <circle cx="400" cy="470" r="70"/>
 <circle cx="400" cy="470" r="14"/>
 <line x1="330" y1="470" x2="470" y2="470"/><line x1="400" y1="400" x2="400" y2="540"/>
 <line x1="351" y1="421" x2="449" y2="519"/><line x1="449" y1="421" x2="351" y2="519"/>
 <rect x="760" y="300" width="300" height="260"/>
 <circle cx="910" cy="430" r="90"/><circle cx="910" cy="430" r="16"/>
 <line x1="820" y1="430" x2="1000" y2="430"/><line x1="910" y1="340" x2="910" y2="520"/>
</g>
<g stroke="#64748b" stroke-width="1" fill="#64748b" font-size="13">
 <line x1="120" y1="600" x2="680" y2="600"/><line x1="120" y1="590" x2="120" y2="610"/><line x1="680" y1="590" x2="680" y2="610"/>
 <text x="400" y="594" text-anchor="middle" stroke="none">4 200</text>
 <line x1="80" y1="300" x2="80" y2="560"/><line x1="70" y1="300" x2="90" y2="300"/><line x1="70" y1="560" x2="90" y2="560"/>
 <text x="72" y="436" text-anchor="middle" stroke="none" transform="rotate(-90 72 436)">1 850</text>
 <text x="400" y="96" text-anchor="middle" stroke="none">DRIVE UNIT</text>
 <text x="910" y="290" text-anchor="middle" stroke="none">SECTION A-A</text>
</g>
<g transform="translate(760 640)" font-size="12" fill="#1f2937">
 <rect width="396" height="168" fill="none" stroke="#1f2937" stroke-width="2"/>
 <line x1="0" y1="44" x2="396" y2="44" stroke="#1f2937"/><line x1="0" y1="92" x2="396" y2="92" stroke="#1f2937"/>
 <line x1="0" y1="130" x2="396" y2="130" stroke="#1f2937"/><line x1="200" y1="92" x2="200" y2="168" stroke="#1f2937"/>
 <line x1="300" y1="92" x2="300" y2="168" stroke="#1f2937"/>
 <text x="12" y="28" font-size="18" font-weight="bold">ACME ENGINEERING</text>
 <text x="384" y="28" font-size="11" text-anchor="end" fill="#64748b">{esc(project.name)} / {esc(project.job_customer_po or "")}</text>
 <text x="12" y="64" font-size="14" font-weight="bold">{esc(row.title or "")}</text>
 <text x="12" y="82" fill="#64748b">{esc(project.project_name)} | {esc(project.job_site or "")}</text>
 <text x="12" y="108" font-size="10" fill="#64748b">DRAWING NO</text><text x="12" y="123" font-size="14" font-weight="bold">{esc(row.drawing_no)}</text>
 <text x="212" y="108" font-size="10" fill="#64748b">REV</text><text x="212" y="123" font-size="14" font-weight="bold">{esc(row.revision or "")}</text>
 <text x="312" y="108" font-size="10" fill="#64748b">SCALE</text><text x="312" y="123" font-size="14">NTS</text>
 <text x="12" y="146" font-size="10" fill="#64748b">DRAWN</text><text x="12" y="161">{esc(drawn_by)}</text>
 <text x="212" y="146" font-size="10" fill="#64748b">SHEET</text><text x="212" y="161">A3 1/1</text>
 <text x="312" y="146" font-size="10" fill="#64748b">DATE</text><text x="312" y="161">{frappe.utils.formatdate(today())}</text>
</g>
<g transform="translate(60 690) rotate(-8)">
 <rect width="250" height="64" rx="8" fill="none" stroke="{stamp_colour}" stroke-width="4"/>
 <text x="125" y="42" font-size="26" font-weight="bold" text-anchor="middle" fill="{stamp_colour}">{status}</text>
</g>
</svg>"""


def use_job_numbers():
	"""New projects continue the demo's numbering (JOB-356 onwards)."""
	make_property_setter("Project", "naming_series", "options", f"{SERIES}\nPROJ-.####", "Text", validate_fields_for_doctype=False)
	make_property_setter("Project", "naming_series", "default", SERIES, "Text", validate_fields_for_doctype=False)
	series = NamingSeries(SERIES)
	if (series.get_current_value() or 0) < LAST_DEMO_NO:
		series.update_counter(LAST_DEMO_NO)
	frappe.clear_cache(doctype="Project")


def ensure_user(key, first, last):
	email = demo_email(key)
	if not frappe.db.exists("User", email):
		frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": first,
				"last_name": last,
				"user_type": "System User",
				"send_welcome_email": 0,
				"roles": [{"role": "Projects User"}],
			}
		).insert(ignore_permissions=True)
	elif not frappe.db.get_value("User", email, "enabled"):
		frappe.db.set_value("User", email, "enabled", 1)
	# Demo addresses don't exist; keep alerts in the bell, not the mail queue.
	if not frappe.db.exists("Notification Settings", email):
		create_notification_settings(email)
	frappe.db.set_value("Notification Settings", email, "enable_email_notifications", 0)
	return email


def ensure_customer(title):
	name = frappe.db.get_value("Customer", {"customer_name": title})
	if name:
		return name
	group = frappe.db.get_single_value("Selling Settings", "customer_group") or frappe.db.get_value(
		"Customer Group", {"is_group": 0}
	)
	territory = frappe.db.get_single_value("Selling Settings", "territory") or frappe.db.get_value(
		"Territory", {"is_group": 0}
	)
	return (
		frappe.get_doc(
			{
				"doctype": "Customer",
				"customer_name": title,
				"customer_type": "Company",
				"customer_group": group,
				"territory": territory,
			}
		)
		.insert(ignore_permissions=True)
		.name
	)


def default_company():
	company = (
		frappe.defaults.get_user_default("Company")
		or frappe.db.get_single_value("Global Defaults", "default_company")
		or frappe.db.get_value("Company", {}, "name")
	)
	if not company:
		frappe.throw(_("Create a Company before loading the demo."))
	return company


def demo_email(key):
	return f"{PEOPLE[key][0].lower()}.{PEOPLE[key][1].lower()}@{DOMAIN}"


def stamp(days_ago):
	"""A working-hours time on the day `days_ago` days back."""
	return add_to_date(get_datetime(add_days(today(), -days_ago)), hours=8 + (days_ago * 7) % 9, minutes=(days_ago * 13) % 60)
