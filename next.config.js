/** @type {import('next').NextConfig} */
const nextConfig = {
    // Pastas em iCloud Drive corrompem com frequência o cache Webpack do Next (ENOENT / chunk 524.js).
    webpack: (config, { dev }) => {
        if (dev) {
            config.cache = false
        }
        return config
    }
}

module.exports = nextConfig
