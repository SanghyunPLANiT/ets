from __future__ import annotations

import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from typing import Any

from .config import OUTPUT_DIR, PROJECT_DIR
from .scenarios import (
    blank_config,
    blank_participant,
    blank_scenario,
    build_markets_from_config,
    load_config,
    normalize_config,
    save_config,
)
from .simulation import run_simulation


class ScenarioEditorApp:
    def __init__(self) -> None:
        self.root = tk.Tk()
        self.root.title("ETS Scenario Dashboard")
        self.root.geometry("1240x760")

        self.config_data: dict[str, Any] = blank_config()
        self.current_file: Path | None = None
        self.current_scenario_index = 0

        self._build_ui()
        self._refresh_scenario_list()
        self._load_scenario_into_form(0)

    def run(self) -> None:
        self.root.mainloop()

    def _build_ui(self) -> None:
        self.root.columnconfigure(1, weight=1)
        self.root.rowconfigure(0, weight=1)

        sidebar = ttk.Frame(self.root, padding=12)
        sidebar.grid(row=0, column=0, sticky="ns")

        body = ttk.Frame(self.root, padding=12)
        body.grid(row=0, column=1, sticky="nsew")
        body.columnconfigure(0, weight=1)
        body.rowconfigure(1, weight=1)

        ttk.Label(sidebar, text="Scenarios").grid(row=0, column=0, sticky="w")
        self.scenario_listbox = tk.Listbox(sidebar, height=22, exportselection=False)
        self.scenario_listbox.grid(row=1, column=0, sticky="ns", pady=(6, 10))
        self.scenario_listbox.bind("<<ListboxSelect>>", self._on_scenario_select)

        buttons = [
            ("Add Scenario", self._add_scenario),
            ("Delete Scenario", self._delete_scenario),
            ("Load Config", self._load_config_file),
            ("Save Config", self._save_config_file),
            ("Save Config As", self._save_config_file_as),
            ("Run Simulation", self._run_simulation),
        ]
        for row, (label, command) in enumerate(buttons, start=2):
            ttk.Button(sidebar, text=label, command=command).grid(
                row=row, column=0, sticky="ew", pady=3
            )

        form = ttk.LabelFrame(body, text="Scenario Settings", padding=12)
        form.grid(row=0, column=0, sticky="ew")
        for column in range(4):
            form.columnconfigure(column, weight=1)

        self.name_var = tk.StringVar()
        self.total_cap_var = tk.StringVar()
        self.auction_mode_var = tk.StringVar()
        self.auctioned_allowances_var = tk.StringVar()
        self.price_lower_bound_var = tk.StringVar()
        self.price_upper_bound_var = tk.StringVar()

        self._form_entry(form, "Name", self.name_var, 0, 0)
        self._form_entry(form, "Total Cap", self.total_cap_var, 0, 1)
        self._form_combo(
            form,
            "Auction Mode",
            self.auction_mode_var,
            ("explicit", "derive_from_cap"),
            0,
            2,
            self._update_auction_entry_state,
        )
        self._form_entry(
            form, "Auctioned Allowances", self.auctioned_allowances_var, 0, 3
        )
        self._form_entry(form, "Price Lower Bound", self.price_lower_bound_var, 2, 0)
        self._form_entry(form, "Price Upper Bound", self.price_upper_bound_var, 2, 1)
        ttk.Button(
            form,
            text="Apply Scenario Changes",
            command=self._save_current_scenario,
        ).grid(row=3, column=3, sticky="e", pady=(22, 0))
        self.auctioned_allowances_entry = form.grid_slaves(row=1, column=3)[0]

        participants_frame = ttk.LabelFrame(body, text="Participants", padding=12)
        participants_frame.grid(row=1, column=0, sticky="nsew", pady=(12, 0))
        participants_frame.columnconfigure(0, weight=1)
        participants_frame.rowconfigure(0, weight=1)

        columns = (
            "name",
            "emissions",
            "free_ratio",
            "penalty",
            "abatement_type",
            "max_abatement",
            "cost_slope",
            "threshold_cost",
        )
        self.participants_tree = ttk.Treeview(
            participants_frame, columns=columns, show="headings", height=15
        )
        headings = {
            "name": "Name",
            "emissions": "Emissions",
            "free_ratio": "Free Ratio",
            "penalty": "Penalty",
            "abatement_type": "Type",
            "max_abatement": "Max Abatement",
            "cost_slope": "Cost Slope",
            "threshold_cost": "Threshold Cost",
        }
        for key, label in headings.items():
            self.participants_tree.heading(key, text=label)
            self.participants_tree.column(key, width=120, anchor="center")
        self.participants_tree.grid(row=0, column=0, sticky="nsew")

        actions = ttk.Frame(participants_frame)
        actions.grid(row=1, column=0, sticky="e", pady=(10, 0))
        ttk.Button(actions, text="Add Participant", command=self._add_participant).grid(
            row=0, column=0, padx=4
        )
        ttk.Button(
            actions, text="Edit Participant", command=self._edit_participant
        ).grid(row=0, column=1, padx=4)
        ttk.Button(
            actions, text="Delete Participant", command=self._delete_participant
        ).grid(row=0, column=2, padx=4)

        self.status_var = tk.StringVar(value="Ready.")
        ttk.Label(self.root, textvariable=self.status_var, padding=(12, 4, 12, 12)).grid(
            row=1, column=0, columnspan=2, sticky="ew"
        )

    def _form_entry(
        self,
        parent: ttk.LabelFrame,
        label: str,
        variable: tk.StringVar,
        row: int,
        column: int,
    ) -> None:
        ttk.Label(parent, text=label).grid(row=row, column=column, sticky="w")
        ttk.Entry(parent, textvariable=variable).grid(
            row=row + 1, column=column, sticky="ew", padx=(0, 8), pady=(4, 0)
        )

    def _form_combo(
        self,
        parent: ttk.LabelFrame,
        label: str,
        variable: tk.StringVar,
        values: tuple[str, ...],
        row: int,
        column: int,
        callback,
    ) -> None:
        ttk.Label(parent, text=label).grid(row=row, column=column, sticky="w")
        combo = ttk.Combobox(parent, textvariable=variable, values=values, state="readonly")
        combo.grid(row=row + 1, column=column, sticky="ew", padx=(0, 8), pady=(4, 0))
        combo.bind("<<ComboboxSelected>>", callback)

    def _refresh_scenario_list(self) -> None:
        self.scenario_listbox.delete(0, tk.END)
        for scenario in self.config_data["scenarios"]:
            self.scenario_listbox.insert(tk.END, scenario["name"])

    def _load_scenario_into_form(self, index: int) -> None:
        if not self.config_data["scenarios"]:
            return
        self.current_scenario_index = index
        scenario = self.config_data["scenarios"][index]

        self.name_var.set(str(scenario["name"]))
        self.total_cap_var.set(str(scenario["total_cap"]))
        self.auction_mode_var.set(str(scenario["auction_mode"]))
        self.auctioned_allowances_var.set(str(scenario["auctioned_allowances"]))
        self.price_lower_bound_var.set(str(scenario["price_lower_bound"]))
        self.price_upper_bound_var.set(str(scenario["price_upper_bound"]))
        self._update_auction_entry_state()

        self.participants_tree.delete(*self.participants_tree.get_children())
        for index, participant in enumerate(scenario["participants"]):
            self.participants_tree.insert(
                "",
                tk.END,
                iid=str(index),
                values=(
                    participant["name"],
                    participant["initial_emissions"],
                    participant["free_allocation_ratio"],
                    participant["penalty_price"],
                    participant["abatement_type"],
                    participant["max_abatement"],
                    participant["cost_slope"],
                    participant["threshold_cost"],
                ),
            )

        self.scenario_listbox.selection_clear(0, tk.END)
        self.scenario_listbox.selection_set(index)

    def _update_auction_entry_state(self, event: object | None = None) -> None:
        state = "disabled" if self.auction_mode_var.get() == "derive_from_cap" else "normal"
        self.auctioned_allowances_entry.configure(state=state)

    def _save_current_scenario(self) -> None:
        scenario = self.config_data["scenarios"][self.current_scenario_index]
        try:
            scenario["name"] = self.name_var.get().strip()
            scenario["total_cap"] = float(self.total_cap_var.get())
            scenario["auction_mode"] = self.auction_mode_var.get().strip()
            scenario["auctioned_allowances"] = float(self.auctioned_allowances_var.get())
            scenario["price_lower_bound"] = float(self.price_lower_bound_var.get())
            scenario["price_upper_bound"] = float(self.price_upper_bound_var.get())
            self.config_data = normalize_config(self.config_data)
        except Exception as exc:
            messagebox.showerror("Invalid Scenario", str(exc))
            return

        self._refresh_scenario_list()
        self._load_scenario_into_form(self.current_scenario_index)
        self.status_var.set("Scenario updated.")

    def _save_current_scenario_silently(self) -> None:
        try:
            scenario = self.config_data["scenarios"][self.current_scenario_index]
            scenario["name"] = self.name_var.get().strip() or scenario["name"]
            scenario["total_cap"] = float(self.total_cap_var.get())
            scenario["auction_mode"] = self.auction_mode_var.get().strip()
            scenario["auctioned_allowances"] = float(self.auctioned_allowances_var.get())
            scenario["price_lower_bound"] = float(self.price_lower_bound_var.get())
            scenario["price_upper_bound"] = float(self.price_upper_bound_var.get())
        except ValueError:
            return

    def _on_scenario_select(self, event: object | None = None) -> None:
        selection = self.scenario_listbox.curselection()
        if not selection:
            return
        self._save_current_scenario_silently()
        self._load_scenario_into_form(selection[0])

    def _add_scenario(self) -> None:
        self._save_current_scenario_silently()
        self.config_data["scenarios"].append(blank_scenario())
        self._refresh_scenario_list()
        self._load_scenario_into_form(len(self.config_data["scenarios"]) - 1)
        self.status_var.set("Scenario added.")

    def _delete_scenario(self) -> None:
        if len(self.config_data["scenarios"]) <= 1:
            messagebox.showwarning("Delete Scenario", "At least one scenario is required.")
            return
        del self.config_data["scenarios"][self.current_scenario_index]
        self._refresh_scenario_list()
        self._load_scenario_into_form(max(0, self.current_scenario_index - 1))
        self.status_var.set("Scenario deleted.")

    def _add_participant(self) -> None:
        participant = ParticipantDialog(self.root, blank_participant()).show()
        if participant is None:
            return
        self.config_data["scenarios"][self.current_scenario_index]["participants"].append(
            participant
        )
        self._load_scenario_into_form(self.current_scenario_index)
        self.status_var.set("Participant added.")

    def _edit_participant(self) -> None:
        selection = self.participants_tree.selection()
        if not selection:
            messagebox.showinfo("Edit Participant", "Select a participant first.")
            return
        index = int(selection[0])
        scenario = self.config_data["scenarios"][self.current_scenario_index]
        updated = ParticipantDialog(self.root, scenario["participants"][index]).show()
        if updated is None:
            return
        scenario["participants"][index] = updated
        self._load_scenario_into_form(self.current_scenario_index)
        self.status_var.set("Participant updated.")

    def _delete_participant(self) -> None:
        selection = self.participants_tree.selection()
        if not selection:
            messagebox.showinfo("Delete Participant", "Select a participant first.")
            return
        index = int(selection[0])
        del self.config_data["scenarios"][self.current_scenario_index]["participants"][index]
        self._load_scenario_into_form(self.current_scenario_index)
        self.status_var.set("Participant deleted.")

    def _load_config_file(self) -> None:
        selected = filedialog.askopenfilename(
            title="Open ETS Config",
            initialdir=PROJECT_DIR,
            filetypes=[("JSON Files", "*.json"), ("All Files", "*.*")],
        )
        if not selected:
            return
        try:
            self.config_data = load_config(selected)
            self.current_file = Path(selected)
            self._refresh_scenario_list()
            self._load_scenario_into_form(0)
            self.status_var.set(f"Loaded {self.current_file.name}.")
        except Exception as exc:
            messagebox.showerror("Load Failed", str(exc))

    def _save_config_file(self) -> None:
        self._save_current_scenario()
        if self.current_file is None:
            self._save_config_file_as()
            return
        try:
            save_config(self.config_data, self.current_file)
            self.status_var.set(f"Saved {self.current_file.name}.")
        except Exception as exc:
            messagebox.showerror("Save Failed", str(exc))

    def _save_config_file_as(self) -> None:
        self._save_current_scenario()
        selected = filedialog.asksaveasfilename(
            title="Save ETS Config",
            initialdir=PROJECT_DIR,
            defaultextension=".json",
            filetypes=[("JSON Files", "*.json"), ("All Files", "*.*")],
        )
        if not selected:
            return
        self.current_file = Path(selected)
        self._save_config_file()

    def _run_simulation(self) -> None:
        try:
            self._save_current_scenario()
            markets = build_markets_from_config(self.config_data)
            summary_df, participant_df = run_simulation(markets=markets, output_dir=OUTPUT_DIR, write_outputs=False)
            messagebox.showinfo(
                "Simulation Complete",
                f"Saved results to:\n{OUTPUT_DIR}\n\n"
                f"Scenarios: {len(summary_df)}\nParticipants: {len(participant_df)}",
            )
            self.status_var.set(f"Simulation complete. Results written to {OUTPUT_DIR}.")
        except Exception as exc:
            messagebox.showerror("Simulation Failed", str(exc))


class ParticipantDialog:
    def __init__(self, parent: tk.Misc, participant: dict[str, Any]) -> None:
        self.top = tk.Toplevel(parent)
        self.top.title("Participant")
        self.top.transient(parent)
        self.top.grab_set()
        self.result: dict[str, Any] | None = None

        self.vars = {
            "name": tk.StringVar(value=str(participant["name"])),
            "initial_emissions": tk.StringVar(value=str(participant["initial_emissions"])),
            "free_allocation_ratio": tk.StringVar(
                value=str(participant["free_allocation_ratio"])
            ),
            "penalty_price": tk.StringVar(value=str(participant["penalty_price"])),
            "abatement_type": tk.StringVar(value=str(participant["abatement_type"])),
            "max_abatement": tk.StringVar(value=str(participant["max_abatement"])),
            "cost_slope": tk.StringVar(value=str(participant["cost_slope"])),
            "threshold_cost": tk.StringVar(value=str(participant["threshold_cost"])),
        }

        frame = ttk.Frame(self.top, padding=12)
        frame.grid(row=0, column=0, sticky="nsew")
        fields = [
            ("Name", "name"),
            ("Initial Emissions", "initial_emissions"),
            ("Free Allocation Ratio", "free_allocation_ratio"),
            ("Penalty Price", "penalty_price"),
            ("Abatement Type", "abatement_type"),
            ("Max Abatement", "max_abatement"),
            ("Cost Slope", "cost_slope"),
            ("Threshold Cost", "threshold_cost"),
        ]

        for row, (label, key) in enumerate(fields):
            ttk.Label(frame, text=label).grid(row=row, column=0, sticky="w", pady=4)
            if key == "abatement_type":
                widget = ttk.Combobox(
                    frame,
                    textvariable=self.vars[key],
                    values=("linear", "threshold"),
                    state="readonly",
                )
            else:
                widget = ttk.Entry(frame, textvariable=self.vars[key])
            widget.grid(row=row, column=1, sticky="ew", padx=(8, 0), pady=4)

        frame.columnconfigure(1, weight=1)
        button_row = ttk.Frame(frame)
        button_row.grid(row=len(fields), column=0, columnspan=2, sticky="e", pady=(10, 0))
        ttk.Button(button_row, text="Cancel", command=self._cancel).grid(
            row=0, column=0, padx=4
        )
        ttk.Button(button_row, text="Save", command=self._save).grid(
            row=0, column=1, padx=4
        )

    def show(self) -> dict[str, Any] | None:
        self.top.wait_window()
        return self.result

    def _cancel(self) -> None:
        self.top.destroy()

    def _save(self) -> None:
        try:
            self.result = {
                "name": self.vars["name"].get().strip(),
                "initial_emissions": float(self.vars["initial_emissions"].get()),
                "free_allocation_ratio": float(
                    self.vars["free_allocation_ratio"].get()
                ),
                "penalty_price": float(self.vars["penalty_price"].get()),
                "abatement_type": self.vars["abatement_type"].get().strip(),
                "max_abatement": float(self.vars["max_abatement"].get()),
                "cost_slope": float(self.vars["cost_slope"].get()),
                "threshold_cost": float(self.vars["threshold_cost"].get()),
            }
        except ValueError as exc:
            messagebox.showerror("Invalid Participant", str(exc), parent=self.top)
            return
        self.top.destroy()


def launch_gui() -> None:
    ScenarioEditorApp().run()
