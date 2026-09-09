import { StyleSheet, Text, View } from 'react-native';

export default function KidHome() {
  return (
    <View style={styles.screen}>
      <Text style={styles.text}>Kid mode</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  text: { fontSize: 28 },
});
