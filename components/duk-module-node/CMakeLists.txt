idf_component_register(SRC_DIRS "."
                    INCLUDE_DIRS "../../components/arduino-esp32/include/$ENV{IDF_TARGET}/" "include"
                    REQUIRES "duktape" "esp32-javascript" "main"
                    EMBED_TXTFILES "loader.js")