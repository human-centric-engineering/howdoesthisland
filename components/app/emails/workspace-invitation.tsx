import * as React from 'react';
import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Section,
  Text,
  Button,
  Hr,
  Heading,
} from '@react-email/components';
import { BRAND } from '@/lib/brand';

/**
 * Tells someone who already has an account that a workspace has invited them
 * (t-9). Unlike core's sign-up invitation it carries no token: the
 * invitation is answered in the app, signed in, so the link only says where.
 */
export interface WorkspaceInvitationEmailProps {
  inviterName: string;
  workspaceName: string;
  /** Plain-English role, e.g. "Member". */
  roleLabel: string;
  /** Where the invitee answers it, e.g. `https://…/settings/workspace`. */
  invitationsUrl: string;
  expiresAt: Date;
}

export default function WorkspaceInvitationEmail({
  inviterName,
  workspaceName,
  roleLabel,
  invitationsUrl,
  expiresAt,
}: WorkspaceInvitationEmailProps): React.ReactElement {
  const expires = new Date(expiresAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <Html lang="en">
      <Head />
      <Preview>{`${inviterName} invited you to ${workspaceName} on ${BRAND.name}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>You have been invited to a workspace</Heading>

          <Text style={text}>
            <strong>{inviterName}</strong> invited you to join <strong>{workspaceName}</strong> on{' '}
            {BRAND.name} as {roleLabel.toLowerCase()}.
          </Text>

          <Text style={text}>
            Sign in to accept or decline. The invitation is open until {expires}.
          </Text>

          <Section style={buttonContainer}>
            <Button href={invitationsUrl} style={button}>
              See the invitation
            </Button>
          </Section>

          <Hr style={hr} />

          <Text style={footer}>
            If you were not expecting this, you can ignore it. Nothing changes unless you accept.
          </Text>
          <Text style={footer}>
            If the button does not work, open this link: <br />
            <a href={invitationsUrl} style={link}>
              {invitationsUrl}
            </a>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const main: React.CSSProperties = {
  backgroundColor: '#f6f9fc',
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', sans-serif",
};

const container: React.CSSProperties = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
  maxWidth: '580px',
};

const h1: React.CSSProperties = {
  color: '#333',
  fontSize: '24px',
  fontWeight: '700',
  lineHeight: '34px',
  margin: '0 0 24px',
  padding: '0 48px',
};

const text: React.CSSProperties = {
  color: '#333',
  fontSize: '16px',
  lineHeight: '26px',
  margin: '16px 0',
  padding: '0 48px',
};

const buttonContainer: React.CSSProperties = {
  padding: '20px 48px',
};

const button: React.CSSProperties = {
  backgroundColor: '#333',
  borderRadius: '5px',
  color: '#fff',
  fontSize: '16px',
  fontWeight: '600',
  textDecoration: 'none',
  display: 'inline-block',
  padding: '12px 28px',
};

const hr: React.CSSProperties = {
  borderColor: '#e6ebf1',
  margin: '32px 0',
};

const footer: React.CSSProperties = {
  color: '#8898aa',
  fontSize: '14px',
  lineHeight: '24px',
  margin: '12px 0',
  padding: '0 48px',
};

const link: React.CSSProperties = {
  color: '#556cd6',
  wordBreak: 'break-all',
};
