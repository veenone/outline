"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "installation_settings",
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
          },
          smtpHost: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          smtpService: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          smtpPort: {
            type: Sequelize.INTEGER,
            allowNull: true,
          },
          smtpUsername: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          smtpPassword: {
            type: Sequelize.BLOB,
            allowNull: true,
          },
          smtpFromEmail: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          smtpReplyEmail: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          smtpName: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          smtpSecure: {
            type: Sequelize.BOOLEAN,
            allowNull: true,
          },
          smtpDisableStarttls: {
            type: Sequelize.BOOLEAN,
            allowNull: true,
          },
          smtpTlsCiphers: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          instanceAdminEmail: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          createdAt: {
            type: Sequelize.DATE,
            allowNull: false,
          },
          updatedAt: {
            type: Sequelize.DATE,
            allowNull: false,
          },
        },
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("installation_settings");
  },
};
