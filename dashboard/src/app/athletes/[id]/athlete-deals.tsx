import type { ReactNode } from "react";
import { Plus } from "lucide-react";

export interface Appointment {
  id: string;
  scheduled_at: string;
  status: string;
  outcome?: string;
  notes?: string;
}

export interface Contract {
  id: string;
  status: string;
  contract_type: string;
  revenue_share_percent?: number;
  signed_at?: string;
  start_date?: string;
  end_date?: string;
}

function shortDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function List({ title, empty, onAdd, addLabel, children }: {
  title: string;
  empty: string;
  onAdd: () => void;
  addLabel: string;
  children: ReactNode[];
}) {
  return (
    <div className="pc-surface">
      <div className="flex items-center justify-between gap-2 border-b border-brand-line px-4 py-2">
        <h3 className="text-sm font-semibold text-brand-ink">{title}</h3>
        <button type="button" onClick={onAdd} className="inline-flex items-center gap-1 text-xs font-medium text-brand-blue">
          <Plus className="h-3 w-3" /> {addLabel}
        </button>
      </div>
      {children.length === 0 ? (
        <p className="px-4 py-3 text-sm text-brand-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-brand-line px-4">{children}</ul>
      )}
    </div>
  );
}

export function AthleteDeals({ appointments, contracts, onAddMeeting, onAddContract }: {
  appointments: Appointment[];
  contracts: Contract[];
  onAddMeeting: () => void;
  onAddContract: () => void;
}) {
  return (
    <section aria-labelledby="deals-heading">
      <h2 id="deals-heading" className="pc-section-heading">Meetings &amp; contracts</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <List title="Meetings" empty="No meetings yet." onAdd={onAddMeeting} addLabel="Add meeting">
          {appointments.map((appt) => (
            <li key={appt.id} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-brand-ink">
                  {new Date(appt.scheduled_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
                <span className="text-xs capitalize text-brand-muted">
                  {appt.outcome ? appt.outcome.replaceAll("_", " ") : appt.status}
                </span>
              </div>
              {appt.notes && <p className="mt-0.5 text-xs text-brand-muted">{appt.notes}</p>}
            </li>
          ))}
        </List>
        <List title="Contracts" empty="No contracts yet." onAdd={onAddContract} addLabel="Add contract">
          {contracts.map((contract) => (
            <li key={contract.id} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium capitalize text-brand-ink">{contract.contract_type.replaceAll("_", " ")}</span>
                <span className="text-xs capitalize text-brand-muted">{contract.status}</span>
              </div>
              <p className="mt-0.5 text-xs text-brand-muted">
                {[
                  contract.revenue_share_percent ? `${contract.revenue_share_percent}% share` : null,
                  contract.start_date ? `from ${shortDate(contract.start_date)}` : null,
                  contract.end_date ? `to ${shortDate(contract.end_date)}` : null,
                  contract.signed_at ? `signed ${shortDate(contract.signed_at)}` : null,
                ].filter(Boolean).join(" · ")}
              </p>
            </li>
          ))}
        </List>
      </div>
    </section>
  );
}
