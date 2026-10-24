import { Path, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { brand } from "@/config/brand";
import { pwaBrand } from "@/config/pwa";

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", marginBottom: 24 },
  name: { fontFamily: "Helvetica-Bold", fontSize: 14, color: pwaBrand.ink, marginLeft: 10 },
  footer: {
    position: "absolute",
    left: 40,
    right: 40,
    bottom: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    fontFamily: "Helvetica",
    fontSize: 8,
    color: "#78716c",
  },
});

/** Native vectors match public/icons/icon-source.svg without any network or file reads. */
export function DocumentBrandHeader() {
  return (
    <View style={styles.header} wrap={false}>
      <Svg width={32} height={32} viewBox="0 0 512 512">
        <Rect width={512} height={512} rx={96} ry={96} fill={pwaBrand.ink} />
        <Path fill={pwaBrand.background} d="M112 160h38v76h57v-76h38v192h-38v-80h-57v80h-38z" />
        <Path
          fill={pwaBrand.accent}
          fillRule="evenodd"
          d="M266 160h61c40 0 64 20 64 51 0 20-10 35-27 42 23 7 36 24 36 45 0 33-27 54-69 54h-65V160zm38 35v43h20c18 0 28-8 28-22s-10-21-28-21h-20zm0 76v46h24c21 0 32-8 32-23s-11-23-32-23h-24z"
        />
      </Svg>
      <Text style={styles.name}>{brand.productName}</Text>
    </View>
  );
}

/** Parent attribution is separate from the merchant's issuer details and repeats on each page. */
export function DocumentBrandFooter() {
  return (
    <View style={styles.footer} fixed>
      <Text>
        Generated with {brand.productName} - © {new Date().getFullYear()} {brand.companyName}
      </Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}
