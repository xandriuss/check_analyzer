from junkanalyzer import analyze_junk
from textdet import ai_parse_receipt


def ai_to_pairs(ai_data):
    pairs = []

    for item in ai_data:
        name = item.get("name", "").strip()
        price = item.get("final_price") or item.get("price", 0)

        try:
            price = f"{float(price):.2f}"
        except:
            continue

        pairs.append((name, price))

    return pairs


def run(image_path):
    # 🔥 AI parsing (fix)
    data = ai_parse_receipt(image_path)

    if not data:
        print("❌ AI nieko nerado")
        return

    pairs = ai_to_pairs(data)

    print("\n=== VISOS PREKĖS ===")
    for p in pairs:
        print(p)

    junk_items, junk_total = analyze_junk(pairs)

    print("\n=== JUNK FOOD ===")
    for j in junk_items:
        print(j)

    print("\n💰 Junk suma:", junk_total)


if __name__ == "__main__":
    run("assets/test.png")