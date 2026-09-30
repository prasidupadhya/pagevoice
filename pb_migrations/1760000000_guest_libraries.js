migrate((app) => {
  const guests = new Collection({
    type: "auth",
    name: "guests",
    listRule: "id = @request.auth.id",
    viewRule: "id = @request.auth.id",
    createRule: "",
    updateRule: null,
    deleteRule: null,
    authRule: "",
    passwordAuth: { enabled: true, identityFields: ["email"] },
    authToken: { duration: 31536000 }, // one year; local random credentials re-authenticate it
  });
  app.save(guests);

  const books = new Collection({
    type: "base",
    name: "books",
    listRule: "owner = @request.auth.id",
    viewRule: "owner = @request.auth.id",
    createRule: "@request.auth.id != '' && owner = @request.auth.id",
    updateRule: "owner = @request.auth.id && @request.body.owner:changed = false",
    deleteRule: "owner = @request.auth.id",
    fields: [
      { name: "owner", type: "relation", required: true, maxSelect: 1, collectionId: guests.id, cascadeDelete: true },
      { name: "project_id", type: "text", required: true, min: 32, max: 32, pattern: "^[0-9a-f]{32}$" },
      { name: "title", type: "text", required: true, max: 300 },
      { name: "author", type: "text", max: 300 },
      { name: "language", type: "text", max: 8 },
      { name: "status", type: "text", max: 32 },
      { name: "format", type: "text", max: 8 },
      { name: "output_ready", type: "bool" },
      { name: "completed_sentences", type: "number", min: 0 },
      { name: "total_sentences", type: "number", min: 0 },
      { name: "deleted", type: "bool" },
      { name: "deleted_at", type: "date" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_books_owner_project ON books (owner, project_id)"],
  });
  app.save(books);

  const settings = app.settings();
  settings.rateLimits.enabled = true;
  settings.rateLimits.rules = [
    { label: "/", maxRequests: 600, duration: 60, audience: "" },
    { label: "/api/collections/guests/records", maxRequests: 12, duration: 60, audience: "@guest" },
    { label: "/api/collections/guests/auth-with-password", maxRequests: 60, duration: 60, audience: "@guest" },
  ];
  app.save(settings);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("books")); } catch (_) {}
  try { app.delete(app.findCollectionByNameOrId("guests")); } catch (_) {}
});
