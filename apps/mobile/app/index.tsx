import { StyleSheet, Text, View } from "react-native";

import { colors } from "@centwise/design-tokens";

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Centwise</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    backgroundColor: colors.neutral[50],
    flex: 1,
    justifyContent: "center"
  },
  title: {
    color: colors.neutral[900],
    fontSize: 24,
    fontWeight: "700"
  }
});