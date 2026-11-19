#include "spektrafilm/spk_engine.h"

#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
void check(bool ok, const std::string& message) {
    if (!ok) throw std::runtime_error(message);
}
void set_env(const char* name, const char* value) {
#ifdef _WIN32
    check(_putenv_s(name, value ? value : "") == 0, "cannot set test environment");
#else
    check((value ? setenv(name, value, 1) : unsetenv(name)) == 0, "cannot set test environment");
#endif
}
void optical(bool active) {
    set_env("SPK_V2_REFERENCE_OPTICAL", active ? "1" : nullptr);
}
using Session = std::unique_ptr<spk_session, decltype(&spk_session_release)>;
struct Frame {
    spk_result result{};
    ~Frame() { spk_result_free(&result); }
};

std::vector<uint16_t> render(spk_engine* engine, spk_session* s, bool* cached = nullptr) {
    Frame frame;
    const auto status = spk_reprint(s, "full", &frame.result);
    check(status == SPK_OK, spk_last_error(engine));
    const auto& r = frame.result;
    check(r.rgba16 && r.width == 96 && r.height == 24, "wrong full frame");
    if (cached) *cached = r.negative_was_cached != 0;
    std::vector<uint16_t> samples;
    for (size_t y = 0; y < r.height; ++y) {
        const auto* begin = r.rgba16 + y * r.row_stride_px * 4;
        samples.insert(samples.end(), begin, begin + r.width * 4);
    }
    return samples;
}
} // namespace

int main(int argc, char** argv) {
    try {
        check(argc == 2, "usage: spk_vulkan_minilab resources_dir");
        set_env("SPK_NEGATIVE_HUE", "0");
        std::unique_ptr<spk_engine, decltype(&spk_engine_destroy)> engine(spk_engine_create(argv[1], nullptr), spk_engine_destroy);
        check(bool(engine), spk_last_error(nullptr));
        constexpr float patches[][3] = {{.025f,.025f,.025f},{.184f,.184f,.184f},{.46f,.24f,.14f},{.08f,.50f,.11f},
                                        {.08f,.12f,.60f},{.66f,.20f,.06f},{.55f,.55f,.55f},{1.8f,1.8f,1.8f}};
        std::vector<float> pixels(96*24*3);
        for (size_t y = 0; y < 24; ++y)
            for (size_t x = 0; x < 96; ++x)
                for (size_t c = 0; c < 3; ++c) pixels[(y * 96 + x) * 3 + c] = patches[x / 12][c];
        const spk_image input{pixels.data(), 96, 24, 3};
        auto open = [&](const std::string& space, const std::string& paper = "kodak_portra_endura", bool scan = false) {
            const std::string p = R"({"film_stock":"kodak_portra_400","grain_active":false,"glare_active":false,"halation_active":false,"auto_exposure":false,"scan_film":)" +
                std::string(scan ? "true" : "false") + ",\"input_cctf_decoding\":false,\"output_color_space\":\"" + space + "\",\"print_stock\":\"" + paper + "\"}";
            Session s(spk_open(engine.get(), &input, p.c_str(), nullptr), spk_session_release);
            check(bool(s), spk_last_error(engine.get()));
            return s;
        };
        for (const std::string space : {"sRGB", "ProPhoto RGB"}) {
            optical(true);
            const auto legacy = render(engine.get(), open(space).get());
            const auto other = render(engine.get(), open(space, "kodak_supra_endura").get());
            const auto scan = render(engine.get(), open(space, "kodak_portra_endura", true).get());
            optical(false);
            auto s = open(space);
            const auto calibrated = render(engine.get(), s.get());
            check(calibrated != legacy, space + ": default pair still renders the optical reference");
            check(render(engine.get(), open(space, "kodak_supra_endura").get()) == other, "unsupported pair changed");
            check(render(engine.get(), open(space, "kodak_portra_endura", true).get()) == scan, "direct scan changed");
            auto sample = [](const auto& img, size_t patch, size_t c) { return img[4 * (12 * 96 + 12 * patch + 6) + c]; };
            check(sample(calibrated, 0, 1) < sample(calibrated, 1, 1) && sample(calibrated, 1, 1) < sample(calibrated, 6, 1),
                  "neutral wedge is not increasing");
            struct Edit { const char* delta; const char* reset; };
            for (const Edit e : {Edit{R"({"print_exposure":1.35})", R"({"print_exposure":1})"},
                                 Edit{R"({"m_filter_shift":0.8})", R"({"m_filter_shift":0})"},
                                 Edit{R"({"y_filter_shift":0.8})", R"({"y_filter_shift":0})"},
                                 Edit{R"({"preflash_exposure":0.05})", R"({"preflash_exposure":0})"}}) {
                check(spk_set_params(s.get(), e.delta, nullptr) == SPK_OK, spk_last_error(engine.get()));
                bool cached = false;
                check(render(engine.get(), s.get(), &cached) != calibrated, std::string("control has no effect: ") + e.delta);
                check(cached, std::string("enlarger control re-developed film: ") + e.delta);
                check(spk_set_params(s.get(), e.reset, nullptr) == SPK_OK, spk_last_error(engine.get()));
                check(render(engine.get(), s.get()) == calibrated, std::string("reset changed the default print: ") + e.delta);
            }
            std::printf("%s: calibrated path, neutral ordering, all enlarger controls and optical/scan isolation pass\n", space.c_str());
        }
        return 0;
    } catch (const std::exception& e) {
        std::fprintf(stderr, "%s\n", e.what());
        return 1;
    }
}
