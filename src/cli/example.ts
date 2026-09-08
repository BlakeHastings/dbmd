/**
 * The example model `dbmd init` writes.
 *
 * This is a `Model` value rather than a folder of template text, and that is a
 * decision rather than a convenience: ADR 0012. `src/model/write.ts` is the one
 * thing that knows how a model file is spelled, and a scaffold written by hand
 * would be a second speller of the same format, drifting quietly the first time
 * a key is renamed. Building the value and handing it to `writeModel` means the
 * scaffold is canonical by construction, and a round-trip test proves it.
 *
 * It is also the first thing every user of dbmd reads, so it is documentation
 * rather than a fixture. Two tables, one ref, one sticky note, and prose that
 * says something a schema dump could not have told them.
 */

import type { Model, Note, Table } from '../model/types.js'

const accounts: Table = {
  kind: 'table',
  name: 'accounts',
  path: 'tables/accounts.md',
  complete: true,
  columns: [
    { name: 'id', type: 'uuid', pk: true },
    { name: 'email', type: 'citext', nullable: false },
    { name: 'display_name', type: 'text', nullable: false },
    { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()' },
  ],
  indexes: [{ name: 'accounts_email_key', columns: ['email'], unique: true }],
  layout: { x: 40, y: 40 },
  body: `
One row per person who can sign in. There is no password column and there never
will be: the identity provider holds credentials, this table holds the profile,
and a copy of this database is therefore not a copy of anybody's password.

\`accounts_email_key\` says \`unique\` above, so the frontmatter carries the
constraint and this paragraph does not have to. What it is here to say is why
\`email\` is \`citext\` and not \`text\`: people type their own address in whatever
case their phone decides on, and one address in two cases is one person with two
accounts unless the type stops caring.
`,
}

const apiKeys: Table = {
  kind: 'table',
  name: 'api_keys',
  path: 'tables/api_keys.md',
  complete: true,
  columns: [
    { name: 'id', type: 'uuid', pk: true },
    { name: 'account_id', type: 'uuid', nullable: false, ref: { table: 'accounts', column: 'id' } },
    { name: 'label', type: 'text', nullable: false },
    { name: 'token_hash', type: 'text', nullable: false },
    { name: 'last_used_at', type: 'timestamptz', nullable: true },
    { name: 'revoked_at', type: 'timestamptz', nullable: true },
    { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()' },
  ],
  indexes: [{ name: 'api_keys_account_idx', columns: ['account_id', 'created_at'] }],
  layout: { x: 420, y: 40 },
  body: `
One row per key an account has issued. \`token_hash\` is a hash, not a key: the
key itself is shown once, at the moment it is created, and is stored nowhere.
"Read me my key back" is a support request with no answer, on purpose.

**Revoking a key does not delete its row.** \`revoked_at\` is stamped and the row
stays, because the audit log points at \`api_keys.id\` and a deleted key turns
every line about it into a dangling reference. So a row existing is not the same
as a key working: every authentication path has to look at \`revoked_at\` too.

The \`ref: accounts.id\` on \`account_id\` is the whole of the relationship. It is
what draws the arrow in the studio and in an exported diagram, and it is the
only place the foreign key is written down.
`,
}

const noPasswords: Note = {
  kind: 'note',
  name: 'there-are-no-passwords-here',
  path: 'notes/there-are-no-passwords-here.md',
  complete: true,
  layout: { x: 40, y: 320, w: 340, h: 180 },
  // The one thing in the scaffold whose only job is to be an example of a key.
  // `color` is optional and a note with none draws plain, which reads as a box
  // rather than as the sticky note the README and `_model.md` both promise. It
  // is also the only place a new user meets the rule that a colour is a name
  // and never a hex value (ADR 0005), and a diff that says `color: amber` is
  // the whole argument for that in one line.
  color: 'amber',
  body: `
Credentials belong to the identity provider. There is no password, no reset
token and no session in this model, and something that looks like one turning up
in a pull request is worth a question before it is worth a review comment.
`,
}

/**
 * The model `dbmd init` scaffolds.
 *
 * A fresh value each call. A shared constant would be handed to `writeModel`,
 * which does not mutate it, and then to whatever the studio does next, which
 * might.
 */
export function exampleModel(): Model {
  return {
    name: 'example',
    engine: 'postgres',
    complete: true,
    tables: [accounts, apiKeys],
    notes: [noPasswords],
    groups: [],
    referencesTo: new Map([
      [
        'accounts',
        [
          {
            from: { table: 'api_keys', column: 'account_id' },
            to: { table: 'accounts', column: 'id' },
          },
        ],
      ],
    ]),
    groupMembers: new Map(),
    /** Written from here, not read from a disk, so there is nothing to refuse. */
    refused: [],
    body: `
An example model, written by \`dbmd init\`. Two tables and a sticky note: enough
to show what the format is for. Change \`name\` and \`engine\` above, then replace
the rest of it with your own.

The frontmatter is the schema. The prose underneath is the reason, and the
reason is the part a schema dump cannot give you. Anything can tell you that
\`api_keys.revoked_at\` is a nullable timestamp; only a person can tell you that a
revoked key keeps its row rather than being deleted, and why that matters at
2am. Write those sentences here and the next developer reads them in the pull
request that changes them.

One object per file, named by the file, under \`tables/\`, \`notes/\` and
\`groups/\`. A note is a sticky note on the canvas. A group is a box drawn round
the tables that declare themselves members of it, so moving the box never
touches a shared file.
`,
  }
}
