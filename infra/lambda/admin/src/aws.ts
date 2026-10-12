// Real AWS clients for the admin Lambda: Cognito user management and the CloudWatch Logs
// audit reader. The Cognito user pool id is resolved lazily from the runtime config
// (SSM) so the Terraform graph stays acyclic (plan v2 §4.4).
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminListGroupsForUserCommand,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminUserGlobalSignOutCommand,
  AdminResetUserPasswordCommand,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import type { AdminUser, AuditEntry, CognitoAdmin } from './handler.js';

const MAX_USERS = 1000;

const attr = (attrs: { Name?: string; Value?: string }[] | undefined, name: string): string | undefined =>
  attrs?.find((a) => a.Name === name)?.Value;

export function createCognitoAdmin(getPoolId: () => Promise<string>): CognitoAdmin {
  const client = new CognitoIdentityProviderClient({});
  const pool = () => getPoolId();

  return {
    async listUsers() {
      const UserPoolId = await pool();
      const users: AdminUser[] = [];
      let token: string | undefined;
      do {
        const res = await client.send(
          new ListUsersCommand({ UserPoolId, Limit: 60, ...(token ? { PaginationToken: token } : {}) }),
        );
        for (const u of res.Users ?? []) {
          const email = attr(u.Attributes, 'email') ?? u.Username ?? '';
          const sub = attr(u.Attributes, 'sub');
          users.push({
            username: u.Username ?? email,
            ...(sub ? { sub } : {}),
            email,
            status: u.UserStatus ?? 'UNKNOWN',
            enabled: u.Enabled !== false,
            groups: [],
          });
        }
        token = res.PaginationToken;
      } while (token && users.length < MAX_USERS);

      // Groups are not part of ListUsers: one call per user (the pool is small).
      await Promise.all(
        users.map(async (u) => {
          try {
            const g = await client.send(new AdminListGroupsForUserCommand({ UserPoolId, Username: u.username }));
            u.groups = (g.Groups ?? []).map((x) => x.GroupName ?? '').filter(Boolean);
          } catch {
            u.groups = [];
          }
        }),
      );
      return users;
    },

    async listGroupsForUser(username) {
      const UserPoolId = await pool();
      const g = await client.send(new AdminListGroupsForUserCommand({ UserPoolId, Username: username }));
      return (g.Groups ?? []).map((x) => x.GroupName ?? '').filter(Boolean);
    },

    async createUser(username, email) {
      const UserPoolId = await pool();
      await client.send(
        new AdminCreateUserCommand({
          UserPoolId,
          Username: username,
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' },
          ],
          DesiredDeliveryMediums: ['EMAIL'],
        }),
      );
    },

    async resendInvitation(username) {
      const UserPoolId = await pool();
      await client.send(
        new AdminCreateUserCommand({ UserPoolId, Username: username, MessageAction: 'RESEND', DesiredDeliveryMediums: ['EMAIL'] }),
      );
    },

    async addToGroup(username, group) {
      const UserPoolId = await pool();
      await client.send(new AdminAddUserToGroupCommand({ UserPoolId, Username: username, GroupName: group }));
    },

    async removeFromGroup(username, group) {
      const UserPoolId = await pool();
      await client.send(new AdminRemoveUserFromGroupCommand({ UserPoolId, Username: username, GroupName: group }));
    },

    async disableUser(username) {
      const UserPoolId = await pool();
      await client.send(new AdminDisableUserCommand({ UserPoolId, Username: username }));
    },

    async enableUser(username) {
      const UserPoolId = await pool();
      await client.send(new AdminEnableUserCommand({ UserPoolId, Username: username }));
    },

    async globalSignOut(username) {
      const UserPoolId = await pool();
      await client.send(new AdminUserGlobalSignOutCommand({ UserPoolId, Username: username }));
    },

    async resetPassword(username) {
      const UserPoolId = await pool();
      await client.send(new AdminResetUserPasswordCommand({ UserPoolId, Username: username }));
    },

    async deleteUser(username) {
      const UserPoolId = await pool();
      await client.send(new AdminDeleteUserCommand({ UserPoolId, Username: username }));
    },
  };
}

/** Reads the `admin_action` records this Lambda writes to its own CloudWatch log group. */
export function createAuditReader(logGroupName: string): (sinceMs: number, limit: number) => Promise<AuditEntry[]> {
  const logs = new CloudWatchLogsClient({});
  return async (sinceMs, limit) => {
    if (!logGroupName) return [];
    try {
      const res = await logs.send(
        new FilterLogEventsCommand({
          logGroupName,
          startTime: sinceMs,
          limit,
          filterPattern: '{ $.evt = "admin_action" }',
          interleaved: false,
        }),
      );
      const out: AuditEntry[] = [];
      for (const e of res.events ?? []) {
        try {
          const parsed = JSON.parse(e.message ?? '') as AuditEntry;
          if (parsed && parsed.evt === 'admin_action') out.push(parsed);
        } catch {
          /* not JSON: skip */
        }
      }
      out.reverse(); // newest first
      return out;
    } catch {
      return [];
    }
  };
}
