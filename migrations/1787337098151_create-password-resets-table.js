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
    pgm.createTable("password_resets", {
        id: "id",
        user_id: {
            type: "integer",
            notNull: true,
            references: "users",
            onDelete: "CASCADE",
        },
        token_hash: { type: "varchar(255)", notNull: true },
        salt: { type: "varchar(64)", notNull: true },
        expires_at: { type: "timestamp", notNull: true },
        used: { type: "boolean", notNull: true, default: false },
        created_at: { type: "timestamp", default: pgm.func("now()") },
    });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
    pgm.dropTable("password_resets");
};
