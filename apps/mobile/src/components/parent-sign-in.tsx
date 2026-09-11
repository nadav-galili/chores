import { isClerkAPIResponseError, useSignIn, useSignUp, useSSO } from '@clerk/expo';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Button, ErrorText, Field, Screen, Title } from '@/components/ui';
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
  const [step, setStep] = useState<Step>({ kind: 'email' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const busy = signInFetch === 'fetching' || signUpFetch === 'fetching';

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => void WebBrowser.coolDownAsync();
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
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: 'oauth_google',
        // No path: `(parent)` is a route group, so it is stripped from the URL and there is
        // no `/parent` to land on — `mibo://parent` hit expo-router's unmatched route with a
        // valid session already in hand. The root knows where a parent goes: the role was
        // persisted when they tapped Parent, so `/` redirects into the group for us.
        redirectUrl: AuthSession.makeRedirectUri({ scheme: 'mibo' }),
      });
      if (createdSessionId && setActive) await setActive({ session: createdSessionId });
      else setError(t('signIn.googleUnfinished'));
    } catch (e) {
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
