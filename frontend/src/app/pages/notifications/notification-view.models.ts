export interface OrganizationItem {
  _id: string;
  name: string;
  myRole: 'admin' | 'manager' | 'member';
}

export interface TeamItem {
  _id: string;
  name: string;
}
