import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

export function Screen({ children }: { children: React.ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export function Title({ children }: { children: string }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor="#888" {...props} />
    </View>
  );
}

export function Button({
  title,
  onPress,
  disabled,
  secondary,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      style={[styles.button, secondary && styles.buttonSecondary, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{title}</Text>
    </Pressable>
  );
}

export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; title: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        {options.map((o) => (
          <Pressable
            key={o.value}
            style={[styles.chip, o.value === value && styles.chipActive]}
            onPress={() => onChange(o.value)}
          >
            <Text style={[styles.chipText, o.value === value && styles.chipTextActive]}>
              {o.title}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function ErrorText({ children }: { children: string | null }) {
  return children ? <Text style={styles.error}>{children}</Text> : null;
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 16, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '600', marginBottom: 8 },
  field: { gap: 6 },
  label: { fontSize: 14, color: '#555' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 18,
  },
  row: { flexDirection: 'row', gap: 8 },
  chip: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999, backgroundColor: '#eee' },
  chipActive: { backgroundColor: '#208AEF' },
  chipText: { fontSize: 16, color: '#333' },
  chipTextActive: { color: 'white', fontWeight: '600' },
  button: {
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: '#208AEF',
    alignItems: 'center',
  },
  buttonSecondary: { backgroundColor: '#eee' },
  buttonText: { color: 'white', fontSize: 18, fontWeight: '600' },
  buttonTextSecondary: { color: '#333' },
  disabled: { opacity: 0.5 },
  error: { color: '#c62828', fontSize: 14 },
});
