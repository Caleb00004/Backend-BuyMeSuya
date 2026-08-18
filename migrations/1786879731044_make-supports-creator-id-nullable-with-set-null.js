/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
    // Drop the existing FK constraint (added implicitly by `references: "users"`)
    pgm.dropConstraint("supports", "supports_creator_id_fkey");

    pgm.addConstraint("supports", "supports_creator_id_fkey", {
        foreignKeys: {
            columns: "creator_id",
            references: "users(id)",
            onDelete: "SET NULL",
        },
    });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
    pgm.dropConstraint("supports", "supports_creator_id_fkey");

    pgm.addConstraint("supports", "supports_creator_id_fkey", {
        foreignKeys: {
            columns: "creator_id",
            references: "users(id)",
        },
    });
};
