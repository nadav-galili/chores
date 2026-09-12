import { isClerkAPIResponseError, useClerk, useSignIn, useSignUp } from '@clerk/expo';
// Core 3's SSO hook, to match the `future` sign-in and sign-up resources this screen already
// uses. The default `useSSO` is the legacy one: it reads `createdSessionId` off a legacy resource
// and has no branch for a sign-in that resolves to an existing session, so it reported "no
// session" for a Google sign-in that had in fact worked (MIBO-3). This one finalizes or activates
// the session itself.
import { useSSO } from '@clerk/expo/experimental';
import * as AuthSession from 'expo-auth-session';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Button, ErrorText, Field, Screen, Title } from '@/components/ui';
import { isMissingBrowser } from '@/lib/browser-error';
import { reportError } from '@/lib/error-reporting';
import { t } from '@/lib/i18n';

WebBrowser.maybeCompleteAuthSession();

type Step = { kind: 'email' } | { kind: 'code'; flow: 'sign-in' | 'sign-up' };

export function ParentSignIn({
  title = t('signIn.title'),
  footer,
}: {
  title?: string;
  footer?: React.ReactNode;
}) {
  const { signIn, fetchStatus: signInFetch } = useSignIn();
  const { signUp, fetchStatus: signUpFetch } = useSignUp();
  const { startSSOFlow } = useSSO();
  const clerk = useClerk();
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'email' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const busy = signInFetch === 'fetching' || signUpFetch === 'fetching';

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    // Warming up binds a Custom Tabs service so the browser opens faster. A phone with no such
    // service rejects both calls, and that is inert: the sign-in still opens through a plain
    // `ACTION_VIEW` and still hands back. Nothing is deduced from the failure — a build that
    // disabled the Google button on it took the only way in away from a phone that worked
    // (MIBO-1). `isMissingBrowser` names the failure that does mean something.
    WebBrowser.warmUpAsync().catch(() => {
      // Inert, per above: an un-warmed browser is a slower one, not an absent one.
    });
    return () =>
      void WebBrowser.coolDownAsync().catch(() => {
        // Cooling down a browser that never warmed up fails the same way and means nothing.
      });
  }, []);

  const sendCode = async () => {
    setError(null);
    const { error: createError } = await signIn.create({ identifier: email.trim() });
    if (!createError) {
      const { error: sendError } = await signIn.emailCode.sendCode({ emailAddress: email.trim() });
      if (sendError) return setError(sendError.message);
      return setStep({ kind: 'code', flow: 'sign-in' });
    }
    const notFound =
      isClerkAPIResponseError(createError) &&
      createError.errors[0]?.code === 'form_identifier_not_found';
    if (!notFound) return setError(createError.message);
    const { error: signUpError } = await signUp.create({ emailAddress: email.trim() });
    if (signUpError) return setError(signUpError.message);
    const { error: sendError } = await signUp.verifications.sendEmailCode();
    if (sendError) return setError(sendError.message);
    setStep({ kind: 'code', flow: 'sign-up' });
  };

  const verifyCode = async () => {
    if (step.kind !== 'code') return;
    setError(null);
    if (step.flow === 'sign-in') {
      const { error: verifyError } = await signIn.emailCode.verifyCode({ code: code.trim() });
      if (verifyError) return setError(verifyError.message);
      if (signIn.status !== 'complete')
        return setError(t('signIn.unfinished', { status: signIn.status }));
      const { error: finalizeError } = await signIn.finalize();
      if (finalizeError) setError(finalizeError.message);
      return;
    }
    const { error: verifyError } = await signUp.verifications.verifyEmailCode({
      code: code.trim(),
    });
    if (verifyError) return setError(verifyError.message);
    if (signUp.status !== 'complete')
      return setError(t('signIn.unfinished', { status: signUp.status }));
    const { error: finalizeError } = await signUp.finalize();
    if (finalizeError) setError(finalizeError.message);
  };

  const google = async () => {
    setError(null);
    try {
      // The path is load-bearing twice over. `sso-callback` is a real screen, so the browser
      // hands back to something rather than expo-router's unmatched route; and it keeps the
      // redirect a *hierarchical* URI. A pathless `mibo://` reaches the app as the opaque
      // `mibo:?rotating_token_nonce=...`, which fails the `startsWith(redirectUrl)` test
      // expo-web-browser ends the auth session on — so the flow resolved `dismiss` and threw
      // away a sign-in that had actually succeeded.
      const { authSessionResult } = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: AuthSession.makeRedirectUri({ scheme: 'mibo', path: 'sso-callback' }),
      });
      // A parent who closed the browser themselves has said everything they mean to; the screen
      // stays as it was and nothing is reported.
      if (authSessionResult?.type === 'cancel') return;
      // Whether we are signed in is Clerk's to answer, not the return value's: the hook activates
      // the session, and a sign-in that resolved to an existing one creates no new id. Reading
      // `createdSessionId` instead is what turned a working sign-in into an error (MIBO-3).
      if (clerk.session) {
        // The redirect left us on `/sso-callback`, which sits outside the `(parent)` group and
        // so has no gate to send a signed-in parent home. Say it explicitly.
        router.replace('/(parent)');
        return;
      }
      // Back with no session and no cancel: the browser opened and never handed back. Reported,
      // because this branch went silent once already and cost MIBO-1 its diagnosis.
      const kind = authSessionResult?.type ?? 'none';
      reportError(new Error(`SSO returned no session (${kind})`), 'parent-sign-in.google');
      setError(t('signIn.googleUnfinished'));
    } catch (e) {
      // The screen says what went wrong, and so does the dashboard: this is the catch that went
      // silent on a real device and cost an instrumented build to read (#35).
      reportError(e, 'parent-sign-in.google');
      // The one failure the parent can act on: this phone has no browser at all, and the email
      // code below needs none. Every other cause reads as itself.
      if (isMissingBrowser(e)) return setError(t('signIn.googleNoBrowser'));
      setError(e instanceof Error ? e.message : t('signIn.googleFailed'));
    }
  };

  if (step.kind === 'code') {
    return (
      <Screen>
        <Title>{t('signIn.codeTitle')}</Title>
        <Field
          label={email}
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          autoFocus
        />
        <ErrorText>{error}</ErrorText>
        <Button
          title={t('common.continue')}
          onPress={verifyCode}
          disabled={busy || code.length < 4}
        />
        <Button
          title={t('signIn.differentEmail')}
          onPress={() => setStep({ kind: 'email' })}
          secondary
        />
        {footer}
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>{title}</Title>
      <Button title={t('signIn.google')} onPress={google} disabled={busy} />
      <Field
        label={t('signIn.emailLabel')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />
      <ErrorText>{error}</ErrorText>
      <Button
        title={t('signIn.emailCode')}
        onPress={sendCode}
        disabled={busy || !email.includes('@')}
      />
      {footer}
    </Screen>
  );
}
