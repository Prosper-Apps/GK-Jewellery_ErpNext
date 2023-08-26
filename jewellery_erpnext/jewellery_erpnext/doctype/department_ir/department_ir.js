// Copyright (c) 2023, Nirali and contributors
// For license information, please see license.txt

frappe.ui.form.on('Department IR', {
	setup: function (frm) {
		frm.set_query("receive_against", function (doc) {
			return {
				filters: {
					current_department: frm.doc.previous_department,
					next_department: frm.doc.current_department
				},
				query: "jewellery_erpnext.jewellery_erpnext.doctype.department_ir.department_ir.department_receive_query"
			}
		})
		frm.set_query("current_department", department_filter(frm))
		frm.set_query("next_department", department_filter(frm))
		frm.set_query("previous_department", department_filter(frm))
		frm.set_query("manufacturing_operation", "department_ir_operation", function (doc, cdt, cdn) {
			var dir_status = frm.doc.type == "Receive" ? "In-Transit" : ["not in", ["In-Transit", "Received"]]
			var filter_dict = {
				"department_ir_status": dir_status
			}
			if (frm.doc.type == "Issue") {
				filter_dict["status"] = ["in", ["Finished", "Revert"]]
				filter_dict["department"] = frm.doc.current_department
			} else {
				if (frm.doc.receive_against) {
					filter_dict["department_issue_id"] = frm.doc.receive_against
				}
			}
			return {
				filters: filter_dict
			}
		})
	},
	type(frm) {
		frm.clear_table("department_ir_operation")
		frm.refresh_field("department_ir_operation")
	},
	receive_against(frm) {
		if (frm.doc.receive_against) {
			frappe.db.get_value("Department IR", frm.doc.receive_against, ["current_department", "next_department"], (r)=>{
				frm.set_value({"previous_department": r.current_department, "current_department": r.next_department})
			})
			frappe.call({
				method: "jewellery_erpnext.jewellery_erpnext.doctype.department_ir.department_ir.get_manufacturing_operations_from_department_ir",
				args: {
					docname: frm.doc.receive_against
				},
				callback(r) {
					frm.clear_table("department_ir_operation")
					$.each(r.message || [], function (i, d) {
						frm.add_child("department_ir_operation", d)
					})
					frm.refresh_field("department_ir_operation")
				}
			})
		}
		else {
			frm.clear_table("department_ir_operation")
			frm.refresh_field("department_ir_operation")
		}
	},
	get_operations(frm) {
		if (!frm.doc.current_department) {
			frappe.throw("Please select current department first")
		}
		var query_filters = {
			"company": frm.doc.company
		}
		if (frm.doc.type == "Issue") {
			query_filters["department_ir_status"] = ["not in", ["In-Transit","Revert"]]
			query_filters["status"] = ["in",["Not Started", "Finished"]]
			query_filters["employee"] = ["is","not set"]
		}
		else {
			query_filters["department_ir_status"] = "In-Transit"
			query_filters["department"] = frm.doc.current_department
		}
		erpnext.utils.map_current_doc({
			method: "jewellery_erpnext.jewellery_erpnext.doctype.department_ir.department_ir.get_manufacturing_operations",
			source_doctype: "Manufacturing Operation",
			target: frm,
			setters: {
				manufacturing_work_order: undefined,
				company: frm.doc.company || undefined,
				department: frm.doc.current_department
			},
			get_query_filters: query_filters,
			size: "extra-large"
		})
	}
});

var department_filter = function (frm) {
	return {
		filters: {
			"company": frm.doc.company
		}
	}
}

