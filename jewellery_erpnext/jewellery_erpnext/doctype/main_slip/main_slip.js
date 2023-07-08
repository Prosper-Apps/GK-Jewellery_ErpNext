// Copyright (c) 2023, Nirali and contributors
// For license information, please see license.txt

frappe.ui.form.on('Main Slip', {
    refresh(frm) {
        cur_frm.add_custom_button(__("Stock Ledger"), async function() {
            var item = (await frappe.call({
                                        method: "jewellery_erpnext.jewellery_erpnext.doctype.main_slip.main_slip.get_item_from_attribute",
                                        args: {
                                            metal_type: frm.doc.metal_type,
                                            metal_touch: frm.doc.metal_touch,
                                            metal_purity: frm.doc.metal_purity,
                                            metal_color: frm.doc.metal_color || null
                                        }
                                    })).message
            frappe.route_options = {
                main_slip: [me.frm.doc.name],
                item_code: item,
                from_date: moment(me.frm.doc.creation).format('YYYY-MM-DD'),
                to_date: moment(me.frm.doc.modified).format('YYYY-MM-DD'),
                company: me.frm.doc.company,
                show_cancelled_entries: me.frm.doc.docstatus === 2
            };
            frappe.set_route("query-report", "Stock Ledger");
        }, __("View"));
    },
    setup: function (frm) {
        frm.set_query("metal_touch", function (doc) {
            return {
                query: 'jewellery_erpnext.query.item_attribute_query',
                filters: { 'item_attribute': "Metal Touch" }
            }
        })
        frm.set_query("metal_purity", function (doc) {
            return {
                query: 'jewellery_erpnext.query.item_attribute_query',
                filters: { 'item_attribute': "Metal Purity", "metal_touch": frm.doc.metal_touch }
            }
        })
        frm.set_query("metal_type", function (doc) {
            return {
                query: 'jewellery_erpnext.query.item_attribute_query',
                filters: { 'item_attribute': "Metal Type" }
            }
        })
    },
    validate(frm) {
        if (frm.doc.check_color) {
            frm.set_value("naming_series", ".dep_abbr.-.type_abbr.-.metal_touch.-.metal_purity.-.color_abbr.-.#####")
        }
        else {
            frm.set_value("naming_series", ".dep_abbr.-.type_abbr.-.metal_touch.-.metal_purity.-.#####")
        }
    },
    tree_wax_wt(frm) {
        if (frm.doc.metal_touch) {
            let field_map = {
                "10KT": "wax_to_gold_10",
                "14KT": "wax_to_gold_14",
                "18KT": "wax_to_gold_18",
                "22KT": "wax_to_gold_22",
                "24KT": "wax_to_gold_24",
            }
            frappe.db.get_value("Jewellery Settings", "Jewellery Settings", field_map[frm.doc.metal_touch], (r) => {
                frm.set_value('computed_gold_wt', flt(frm.doc.tree_wax_wt) * flt(r[field_map[frm.doc.metal_touch]]))
            })
        }
    },
    async before_submit(frm) {
        let promise = new Promise((resolve, reject) => {
            var dialog = new frappe.ui.Dialog({
                title: __("Submit"),
                fields: [
                    {
                        "fieldtype": "Float",
                        "label": __("Actual Pending Gold"),
                        "fieldname": "actual_pending_metal",
                        onchange: () => {
                            let actual = flt(dialog.get_value('actual_pending_metal'))
                            if (actual > frm.doc.pending_metal) {
                                frappe.msgprint("Actual pending gold cannot be greater than pending gold")
                                dialog.set_value('actual_pending_metal', 0)
                                return
                            }
                            let loss = frm.doc.pending_metal - actual
                            dialog.set_value('metal_loss', loss)
                        }
                    },
                    {
                        "fieldtype": "Float",
                        "label": __("Gold Loss"),
                        "fieldname": "metal_loss",
                        "read_only": 1
                    }
                ],
                primary_action: function () {
                    let values = dialog.get_values();
                    frappe.call({
                    	method: 'jewellery_erpnext.jewellery_erpnext.doctype.main_slip.main_slip.create_stock_entries',
                    	args: {
                            'main_slip': frm.doc.name,
                            'actual_qty': flt(values.actual_pending_metal),
                            'metal_loss': flt(values.metal_loss),
                    		'metal_type': frm.doc.metal_type,
                    		'metal_touch': frm.doc.metal_touch,
                    		'metal_purity': frm.doc.metal_purity,
                    		'metal_colour': frm.doc.metal_color,
                    	},
                    	callback: function(r) {
                            console.log(r.message)
                    		dialog.hide();
                            resolve()
                    	},
                    });
                },
                primary_action_label: __('Submit')
            });
            dialog.show();
        });
        await promise.catch(() => {
        });
    }
})