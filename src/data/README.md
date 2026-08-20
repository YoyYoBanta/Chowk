Data-access layer. Every exported function that reads/writes a model owned
by an organization (User today; Channel/Contact/Conversation/Message from
M2 on) takes `organizationId: string` as a required, non-optional first
parameter and scopes its query by it — see organizations.ts's doc comment
for the one deliberate exception (Organization is the tenant root and has
no organizationId of its own) and users.ts's doc comment for the one
deliberate exception on the User side (the M1 login bootstrap path, before
a session/organizationId exists). No other function may query a model
without organizationId. See architecture.md §12.
