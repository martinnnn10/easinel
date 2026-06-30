// Role-based access control. Five roles map to how plants are actually
// organized; permissions are coarse-grained capabilities checked in routes.

export const ROLES = ["owner", "admin", "manager", "technician", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Maintenance Manager",
  technician: "Technician",
  viewer: "Viewer",
};

export type Permission =
  | "manage_users"
  | "manage_integrations"
  | "manage_api_keys"
  | "manage_webhooks"
  | "create_work_order"
  | "request_work_order"
  | "approve_work_order"
  | "update_work_order"
  | "delete_work_order"
  | "manage_workforce"
  | "upload_documents"
  | "manage_assets"
  | "delete_assets"
  | "manage_pm"
  | "complete_pm"
  | "manage_parts"
  | "ask_copilot"
  | "view";

const MATRIX: Record<Permission, Role[]> = {
  manage_users: ["owner", "admin"],
  manage_integrations: ["owner", "admin"],
  manage_api_keys: ["owner", "admin"],
  manage_webhooks: ["owner", "admin"],
  manage_workforce: ["owner", "admin", "manager"],
  manage_assets: ["owner", "admin", "manager", "technician"],
  delete_assets: ["owner", "admin"],
  create_work_order: ["owner", "admin", "manager", "technician"],
  // Anyone on the floor (incl. viewers) may SUBMIT a maintenance request; it is
  // born pending and does no work until a manager/supervisor approves it.
  request_work_order: ["owner", "admin", "manager", "technician", "viewer"],
  // Only a maintenance manager/supervisor (or above) may approve/reject requests.
  approve_work_order: ["owner", "admin", "manager"],
  update_work_order: ["owner", "admin", "manager", "technician"],
  delete_work_order: ["owner", "admin", "manager"],
  // PM programs must be approved/managed by planners+ ; technicians can complete.
  manage_pm: ["owner", "admin", "manager"],
  complete_pm: ["owner", "admin", "manager", "technician"],
  manage_parts: ["owner", "admin", "manager", "technician"],
  upload_documents: ["owner", "admin", "manager", "technician"],
  ask_copilot: ["owner", "admin", "manager", "technician", "viewer"],
  view: ["owner", "admin", "manager", "technician", "viewer"],
};

export function can(role: Role, perm: Permission): boolean {
  return MATRIX[perm]?.includes(role) ?? false;
}

export function isValidRole(r: string): r is Role {
  return (ROLES as readonly string[]).includes(r);
}
