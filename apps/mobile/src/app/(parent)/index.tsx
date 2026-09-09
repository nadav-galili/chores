import { StyleSheet, Text, View } from 'react-native';

export default function ParentHome() {
  return (
    <View style={styles.screen}>
      <Text style={styles.text}>Parent mode</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  text: { fontSize: 20 },
});
