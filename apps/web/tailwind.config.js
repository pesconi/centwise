/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ["./app/**/*.{js,ts,jsx,tsx}", "./src/**/*.{js,ts,jsx,tsx}"],
    theme: {
        extend: {
            colors: {
                canvas: "#F7F7F2",
                ink: "#17211D",
                spruce: "#166145",
                mint: "#DDEFE6",
                clay: "#E87A5D",
                fog: "#E7EAE5"
            },
            fontFamily: {
                sans: ["Aptos", "Segoe UI", "sans-serif"]
            }
        }
    },
    plugins: []
};