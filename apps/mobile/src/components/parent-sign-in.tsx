import { isClerkAPIResponseError, useSignIn, useSignUp, useSSO } from '@clerk/expo';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Button, ErrorText, Field, Screen, Title } from '@/components/ui';

WebBrowser.maybeCompleteAuthSession();

type Step = { kind: 'email' } | { kind: 'code'; flow: 'sign-in' | 'sign-up' };

export function ParentSignIn({
  title = 'Sign in as a parent',
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
      if (signIn.status !== 'complete') return setError(`Sign-in is ${signIn.status}`);
      const { error: finalizeError } = await signIn.finalize();
      if (finalizeError) setError(finalizeError.message);
      return;
    }
    const { error: verifyError } = await signUp.verifications.verifyEmailCode({
      code: code.trim(),
    });
    if (verifyError) return setError(verifyError.message);
    if (signUp.status !== 'complete') return setError(`Sign-up is ${signUp.status}`);
    const { error: finalizeError } = await signUp.finalize();
    if (finalizeError) setError(finalizeError.message);
  };

  const google = async () => {
    setError(null);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: AuthSession.makeRedirectUri({ scheme: 'mibo', path: 'parent' }),
      });
      if (createdSessionId && setActive) await setActive({ session: createdSessionId });
      else setError('Google sign-in did not finish');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Google sign-in failed');
    }
  };

  if (step.kind === 'code') {
    return (
      <Screen>
        <Title>Enter the code we emailed you</Title>
        <Field
          label={email}
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          autoFocus
        />
        <ErrorText>{error}</ErrorText>
        <Button title="Continue" onPress={verifyCode} disabled={busy || code.length < 4} />
        <Button
          title="Use a different email"
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
      <Button title="Continue with Google" onPress={google} disabled={busy} />
      <Field
        label="Or use your email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />
      <ErrorText>{error}</ErrorText>
      <Button title="Email me a code" onPress={sendCode} disabled={busy || !email.includes('@')} />
      {footer}
    </Screen>
  );
}
