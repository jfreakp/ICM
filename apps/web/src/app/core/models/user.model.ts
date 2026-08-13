export interface User {
  id: number;
  email: string;
  full_name: string;
  is_admin: boolean;
  must_change_password: boolean;
}
