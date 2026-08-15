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
    pgm.addColumns("users", {
        twitter_url: { type: "varchar(255)" },
        instagram_url: { type: "varchar(255)" },
        facebook_url: { type: "varchar(255)" },
        tiktok_url: { type: "varchar(255)" },
        youtube_url: { type: "varchar(255)" },
    });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
    pgm.dropColumns("users", [
        "twitter_url",
        "instagram_url",
        "facebook_url",
        "tiktok_url",
        "youtube_url",
    ]);
};
