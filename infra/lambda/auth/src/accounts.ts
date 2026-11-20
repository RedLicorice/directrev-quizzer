// Cognito account creation for invite links (auth Lambda, IAM: AdminCreateUser + AdminSetUserPassword only).
// The pool id is resolved lazily from the runtime config (SSM) to keep the Terraform graph acyclic.
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';

export interface AccountCreator {
  /**
   * Creates a confirmed user (no e-mail is sent, the e-mail is marked verified) with that password
   * and NO group. Resolves to the Cognito `Username` (the id the admin Lambda addresses users by;
   * a generated id, not the e-mail, in a pool that signs in with the e-mail). Rejects with an
   * error named `UsernameExistsException` or `InvalidPasswordException` when Cognito says so; in
   * both cases no user is left behind.
   */
  create(email: string, password: string): Promise<string>;
}

export function createAccountCreator(
  getPoolId: () => Promise<string>,
  client: Pick<CognitoIdentityProviderClient, 'send'> = new CognitoIdentityProviderClient({}),
): AccountCreator {
  return {
    async create(email, password) {
      const UserPoolId = await getPoolId();
      // The chosen password is the temporary one: Cognito checks it against the pool policy
      // here, so a weak password fails before any user exists. The next call makes it permanent.
      const created = await client.send(
        new AdminCreateUserCommand({
          UserPoolId,
          Username: email,
          TemporaryPassword: password,
          MessageAction: 'SUPPRESS',
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' },
          ],
        }),
      );
      await client.send(new AdminSetUserPasswordCommand({ UserPoolId, Username: email, Password: password, Permanent: true }));
      return created.User?.Username ?? email;
    },
  };
}
