export interface UserListItem {
  id: number;
  email: string;
  full_name: string;
  is_admin: boolean;
  is_active: boolean;
  allowed_ip: string | null;
}
