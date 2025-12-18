import { faker } from "@faker-js/faker";
import { randomUUID } from "crypto";
import { createContext } from "@server/context";
import { User, UserAuthentication } from "@server/models";
import { buildUser, buildTeam, buildInvite } from "@server/test/factories";
import userSyncer, { SyncUser } from "./userSyncer";

describe("userSyncer", () => {
  const ip = faker.internet.ip();
  const ctx = createContext({ ip });

  it("should create new users from provider", async () => {
    const team = await buildTeam();
    const authProviders = await team.$get("authenticationProviders");
    const authProvider = authProviders[0];

    const syncUsers: SyncUser[] = [
      {
        providerId: randomUUID(),
        email: "newuser1@example.com",
        name: "New User 1",
      },
      {
        providerId: randomUUID(),
        email: "newuser2@example.com",
        name: "New User 2",
      },
    ];

    const result = await userSyncer(ctx, {
      teamId: team.id,
      authenticationProviderId: authProvider.id,
      users: syncUsers,
    });

    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.suspended).toBe(0);
    expect(result.errors.length).toBe(0);

    // Verify users were created
    const user1 = await User.findOne({
      where: { email: "newuser1@example.com", teamId: team.id },
    });
    expect(user1).toBeTruthy();
    expect(user1?.name).toBe("New User 1");

    const user2 = await User.findOne({
      where: { email: "newuser2@example.com", teamId: team.id },
    });
    expect(user2).toBeTruthy();
    expect(user2?.name).toBe("New User 2");

    // Verify authentication records were created
    const auth1 = await UserAuthentication.findOne({
      where: { userId: user1!.id },
    });
    expect(auth1).toBeTruthy();
    expect(auth1?.providerId).toBe(syncUsers[0].providerId);
  });

  it("should update existing users when details change", async () => {
    const user = await buildUser();
    const authentications = await user.$get("authentications");
    const existingAuth = authentications[0];

    const newName = "Updated Name";
    const syncUsers: SyncUser[] = [
      {
        providerId: existingAuth.providerId,
        email: user.email!,
        name: newName,
      },
    ];

    const result = await userSyncer(ctx, {
      teamId: user.teamId,
      authenticationProviderId: existingAuth.authenticationProviderId,
      users: syncUsers,
    });

    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);
    expect(result.suspended).toBe(0);

    // Verify user was updated
    await user.reload();
    expect(user.name).toBe(newName);
  });

  it("should not update users when details are unchanged", async () => {
    const user = await buildUser();
    const authentications = await user.$get("authentications");
    const existingAuth = authentications[0];

    const syncUsers: SyncUser[] = [
      {
        providerId: existingAuth.providerId,
        email: user.email!,
        name: user.name,
      },
    ];

    const result = await userSyncer(ctx, {
      teamId: user.teamId,
      authenticationProviderId: existingAuth.authenticationProviderId,
      users: syncUsers,
    });

    expect(result.unchanged).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.created).toBe(0);
    expect(result.suspended).toBe(0);
  });

  it("should suspend users not in provider list", async () => {
    const user = await buildUser();
    const authentications = await user.$get("authentications");
    const existingAuth = authentications[0];

    // Sync with a different user (original user not in list)
    const syncUsers: SyncUser[] = [
      {
        providerId: randomUUID(),
        email: "otheruser@example.com",
        name: "Other User",
      },
    ];

    const result = await userSyncer(ctx, {
      teamId: user.teamId,
      authenticationProviderId: existingAuth.authenticationProviderId,
      users: syncUsers,
    });

    expect(result.suspended).toBe(1);
    expect(result.created).toBe(1);

    // Verify user was suspended
    await user.reload();
    expect(user.suspendedAt).toBeTruthy();
  });

  it("should reactivate suspended users when they reappear in provider", async () => {
    const user = await buildUser();
    const authentications = await user.$get("authentications");
    const existingAuth = authentications[0];

    // Suspend the user
    await user.update({ suspendedAt: new Date() });
    expect(user.suspendedAt).toBeTruthy();

    // Sync with the user back in the list
    const syncUsers: SyncUser[] = [
      {
        providerId: existingAuth.providerId,
        email: user.email!,
        name: user.name,
      },
    ];

    const result = await userSyncer(ctx, {
      teamId: user.teamId,
      authenticationProviderId: existingAuth.authenticationProviderId,
      users: syncUsers,
    });

    expect(result.reactivated).toBe(1);

    // Verify user was reactivated
    await user.reload();
    expect(user.suspendedAt).toBeNull();
  });

  it("should link existing users by email to new authentication", async () => {
    const team = await buildTeam();
    const authProviders = await team.$get("authenticationProviders");
    const authProvider = authProviders[0];

    // Create an invited user (no authentication record)
    const invite = await buildInvite({
      teamId: team.id,
      email: "invited@example.com",
    });

    const providerId = randomUUID();
    const syncUsers: SyncUser[] = [
      {
        providerId,
        email: "invited@example.com",
        name: "Invited User Updated",
      },
    ];

    const result = await userSyncer(ctx, {
      teamId: team.id,
      authenticationProviderId: authProvider.id,
      users: syncUsers,
    });

    // Should link existing user, not create new one
    expect(result.created).toBe(0);
    expect(result.updated).toBe(1); // Name was updated

    // Verify authentication was created for existing user
    const auth = await UserAuthentication.findOne({
      where: { userId: invite.id, authenticationProviderId: authProvider.id },
    });
    expect(auth).toBeTruthy();
    expect(auth?.providerId).toBe(providerId);
  });

  it("should not suspend all users when provider returns empty list", async () => {
    const user = await buildUser();
    const authentications = await user.$get("authentications");
    const existingAuth = authentications[0];

    // Sync with empty list
    const result = await userSyncer(ctx, {
      teamId: user.teamId,
      authenticationProviderId: existingAuth.authenticationProviderId,
      users: [],
    });

    expect(result.suspended).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("empty user list");

    // Verify user was NOT suspended
    await user.reload();
    expect(user.suspendedAt).toBeNull();
  });

  it("should skip users without email addresses", async () => {
    const team = await buildTeam();
    const authProviders = await team.$get("authenticationProviders");
    const authProvider = authProviders[0];

    const syncUsers: SyncUser[] = [
      {
        providerId: randomUUID(),
        email: "", // Empty email
        name: "No Email User",
      },
      {
        providerId: randomUUID(),
        email: "valid@example.com",
        name: "Valid User",
      },
    ];

    const result = await userSyncer(ctx, {
      teamId: team.id,
      authenticationProviderId: authProvider.id,
      users: syncUsers,
    });

    expect(result.created).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("no email");
  });

  it("should handle case-insensitive email matching", async () => {
    const user = await buildUser({ email: "test@example.com" });
    const authentications = await user.$get("authentications");
    const existingAuth = authentications[0];

    const syncUsers: SyncUser[] = [
      {
        providerId: existingAuth.providerId,
        email: "TEST@EXAMPLE.COM", // Different case
        name: user.name,
      },
    ];

    const result = await userSyncer(ctx, {
      teamId: user.teamId,
      authenticationProviderId: existingAuth.authenticationProviderId,
      users: syncUsers,
    });

    // Should match existing user, not create new one
    expect(result.unchanged).toBe(1);
    expect(result.created).toBe(0);
  });

  it("should return error when team not found", async () => {
    const team = await buildTeam();
    const authProviders = await team.$get("authenticationProviders");
    const authProvider = authProviders[0];

    const result = await userSyncer(ctx, {
      teamId: randomUUID(), // Non-existent team
      authenticationProviderId: authProvider.id,
      users: [
        { providerId: randomUUID(), email: "test@example.com", name: "Test" },
      ],
    });

    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("Team");
    expect(result.errors[0]).toContain("not found");
  });

  it("should return error when authentication provider not found", async () => {
    const team = await buildTeam();

    const result = await userSyncer(ctx, {
      teamId: team.id,
      authenticationProviderId: randomUUID(), // Non-existent provider
      users: [
        { providerId: randomUUID(), email: "test@example.com", name: "Test" },
      ],
    });

    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("Authentication provider");
    expect(result.errors[0]).toContain("not found");
  });
});
