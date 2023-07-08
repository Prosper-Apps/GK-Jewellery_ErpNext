# Copyright (c) 2023, Nirali and contributors
# For license information, please see license.txt

import frappe
import json
from frappe import _
from frappe.utils import flt
from frappe.model.mapper import get_mapped_doc
from frappe.model.document import Document
from jewellery_erpnext.jewellery_erpnext.doctype.main_slip.main_slip import get_main_slip_item, get_item_from_attribute

class EmployeeIR(Document):
	@frappe.whitelist()
	def get_operations(self):
		records = frappe.get_list("Manufacturing Operation",{"department": self.department,
						       "employee": ["is","not set"], "operation": ["is","not set"]},["name","gross_wt"])
		self.employee_ir_operations = []
		if records:
			for row in records:
				self.append("employee_ir_operations",{
					"manufacturing_operation": row.name
				})

	def on_submit(self):
		if self.type == "Issue":
			self.on_submit_issue()
		else:
			self.on_submit_receive()
	
	def validate(self):
		self.validate_gross_wt()
		self.update_main_slip()

	def on_cancel(self):
		self.on_submit_issue(cancel=True)
		self.on_submit_receive(cancel=True)

	def validate_gross_wt(self):
		for row in self.employee_ir_operations:
			if not self.main_slip:
				if row.gross_wt < row.received_gross_wt:
					frappe.throw(f"Row #{row.idx}: Received gross wt cannot be greater than gross wt")


	#for issue
	def on_submit_issue(self, cancel=False):
		employee = None if cancel else self.employee
		operation = None if cancel else self.operation
		status = "Not Started" if cancel else "WIP"
		values = {"employee": employee, "operation": operation, "status": status}
		
		for row in self.employee_ir_operations:
			if not cancel:
				create_stock_entry(self,row)
			# values["gross_wt"] = get_value("Stock Entry Detail", {'manufacturing_operation': row.manufacturing_operation, "to_employee":self.employee}, 'sum(if(uom="cts",qty*0.2,qty))', 0)
			frappe.db.set_value("Manufacturing Operation", row.manufacturing_operation, values)

	#for receive
	def on_submit_receive(self, cancel=False):
		for row in self.employee_ir_operations:
			if not cancel:
				create_operation_for_next_op(row.manufacturing_operation)
				difference_wt = flt(row.gross_wt) - flt(row.received_gross_wt)
				create_stock_entry(self, row, difference_wt)

			# gross_wt = get_value("Stock Entry Detail", {'manufacturing_operation': row.manufacturing_operation, "employee":self.employee}, 'sum(if(uom="cts",qty*0.2,qty))', 0)
			frappe.set_value("Manufacturing Operation", row.manufacturing_operation, "status", "WIP" if cancel else "Finished")

	def update_main_slip(self):
		if not self.main_slip:
			return
		main_slip = frappe.get_doc("Main Slip",self.main_slip)
		for row in self.employee_ir_operations:
			if not main_slip.get("main_slip_operation",{"manufacturing_operation":row.manufacturing_operation}):
				main_slip.append("main_slip_operation",{"manufacturing_operation":row.manufacturing_operation})
		main_slip.save()

def create_operation_for_next_op(docname, target_doc=None):
	def set_missing_value(source, target):
		target.previous_operation = source.operation

	target_doc = get_mapped_doc("Manufacturing Operation", docname,
			{
			"Manufacturing Operation" : {
				"doctype":	"Manufacturing Operation",
				"field_no_map": ['status','employee',"start_time",
		     					"finish_time", "time_taken", "department_issue_id",
								"department_receive_id", "department_ir_status", "operation", "previous_operation"]
			}
			}, target_doc, set_missing_value)

	target_doc.time_taken = None
	target_doc.save()

@frappe.whitelist()
def get_manufacturing_operations():
	records = frappe.get_list("Manufacturing Operation",{},["name","gross_wt"])
	return records

@frappe.whitelist()
def get_manufacturing_operations(source_name, target_doc=None):
	if not target_doc:
		target_doc = frappe.new_doc("Employee IR")
	elif isinstance(target_doc, str):
		target_doc = frappe.get_doc(json.loads(target_doc))
	if not target_doc.get("employee_ir_operations",{"manufacturing_operation":source_name}):
		operation = frappe.db.get_value("Manufacturing Operation", source_name, ["gross_wt","manufacturing_work_order"],as_dict=1)
		target_doc.append("employee_ir_operations",{"manufacturing_operation":source_name, 
					      "gross_wt": operation["gross_wt"], "manufacturing_work_order": operation["manufacturing_work_order"]})
	return target_doc

def create_stock_entry(doc, row, difference_wt=0):
	settings = frappe.db.get_value("Jewellery Settings","Jewellery Settings", ["employee_wip", "department_wip"], as_dict=1)
	stock_entries = frappe.db.sql(f"""select se.name from `tabStock Entry Detail` sed left join `tabStock Entry` se on sed.parent = se.name 
			       where sed.manufacturing_operation = '{row.manufacturing_operation}' and 
				   {"sed.s_warehouse" if doc.type == "Issue" else "sed.t_warehouse"} = '{settings.department_wip}' 
				   and sed.to_department = '{doc.department}'""", as_dict=1)
	item = None
	metal_item = None
	if doc.main_slip:
		item = get_main_slip_item(doc.main_slip)

	if difference_wt != 0:
		mwo = frappe.db.get_value("Manufacturing Work Order", row.manufacturing_work_order, ["metal_type", "metal_touch", "metal_purity", "metal_color"], as_dict=1)
		metal_item = get_item_from_attribute(mwo.metal_type, mwo.metal_touch, mwo.metal_purity, mwo.metal_color)
		existing_items = frappe.get_all("Stock Entry Detail",{"parent": ['in',stock_entries]}, pluck='item_code')
		if metal_item not in existing_items and difference_wt != 0:
			frappe.throw(_("Stock Entry for metal not found. Unable to add/subtract weight difference"))
	for stock_entry in stock_entries:
		existing_doc = frappe.get_doc("Stock Entry", stock_entry)
		stock_entry = frappe.copy_doc(existing_doc)
		for child in stock_entry.items:
			if doc.type == "Issue":
				child.s_warehouse = settings.department_wip
				child.t_warehouse = settings.employee_wip
				child.to_employee = doc.employee
				child.employee = None
				child.department_operation = doc.operation
				child.main_slip = None
				child.to_main_slip = doc.main_slip if item == child.item_code else None
			else:
				child.s_warehouse = settings.employee_wip
				child.t_warehouse = settings.department_wip
				child.to_employee = None
				child.employee = doc.employee
				child.to_main_slip = None
				child.main_slip = doc.main_slip if item == child.item_code else None
			child.qty = child.qty + (difference_wt if metal_item == child.item_code else 0)
			if child.qty < 0:
				frappe.throw(_("Qty cannot be negative"))
			child.manufacturing_operation = row.manufacturing_operation
			child.department = doc.department
			child.to_department = doc.department
			child.manufacturer =  doc.manufacturer
			child.material_request = None
			child.material_request_item = None
		
		stock_entry.flags.auto_created = True
		stock_entry.manufacturing_operation = row.manufacturing_operation
		stock_entry.save()
		stock_entry.submit()