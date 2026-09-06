plugins {
    java
    id("com.gtnewhorizons.retrofuturagradle") version "2.0.2"
}

apply(from = "gradle/exporter-provenance.gradle")

group = "com.recipetree"
version = "1.2.0-beta.128"

val minimumJeiApiVersion = "4.12.0.214"
val maximumJeiApiVersionExclusive = "5.0.0"
val publishedJeiCompatibilityDependency = "mezz.jei:jei_1.12.2:$minimumJeiApiVersion"

val configuredJeiApiJar = providers.gradleProperty("jeiApiJar").orNull?.let(::file)

java {
    sourceCompatibility = JavaVersion.VERSION_1_8
    targetCompatibility = JavaVersion.VERSION_1_8
}

minecraft {
    mcVersion.set("1.12.2")
    username.set("JEIExporter")
    extraRunJvmArguments.addAll(
        "-Dfile.encoding=UTF-8",
        "-Djeiexport.auto=false"
    )
}

repositories {
    maven {
        name = "BlameJared"
        url = uri("https://maven.blamejared.com")
        content {
            includeGroup("mezz.jei")
        }
    }
    maven {
        name = "CleanroomMC"
        url = uri("https://maven.cleanroommc.com")
        content {
            includeGroup("mezz")
        }
    }
    mavenCentral()
}

dependencies {
    val jeiDevelopmentDependency: Any = if (configuredJeiApiJar != null) {
        require(configuredJeiApiJar.isFile) {
            "[jeiexport] -PjeiApiJar must identify a readable HEI/JEI jar; got $configuredJeiApiJar"
        }
        logger.lifecycle(
            "[jeiexport] Compiling against explicit HEI/JEI API jar: $configuredJeiApiJar"
        )
        rfg.deobf(files(configuredJeiApiJar))
    } else {
        logger.lifecycle(
            "[jeiexport] No -PjeiApiJar was supplied; compiling against the published standard JEI " +
                "$minimumJeiApiVersion compatibility floor. Release validation must also compile " +
                "against any separately supported HEI floor artifact."
        )
        rfg.deobf(publishedJeiCompatibilityDependency)
    }

    compileOnly(jeiDevelopmentDependency)
    runtimeOnly(jeiDevelopmentDependency)
    testCompileOnly(jeiDevelopmentDependency)
    testImplementation("junit:junit:4.13.2")
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.compilerArgs.addAll(listOf("-Xlint:deprecation", "-Xlint:unchecked"))
}

tasks.named<JavaCompile>("compileJava") {
    // source/target=8 controls the class-file version but still exposes the host JDK API.
    // --release 8 also compiles this mod against Java 8's API signatures, preventing newer
    // covariant NIO Buffer descriptors from entering the jar. RFG's generated Minecraft
    // launcher tasks use a real Java 8 compiler, so this must remain scoped to our source task.
    options.release.set(8)
}

tasks.processResources {
    inputs.property("version", project.version)
    inputs.property("jeiApiVersion", minimumJeiApiVersion)
    inputs.property("jeiApiVersionMaximum", maximumJeiApiVersionExclusive)
    filesMatching("mcmod.info") {
        expand(
            "version" to project.version,
            "jeiApiVersion" to minimumJeiApiVersion,
            "jeiApiVersionMaximum" to maximumJeiApiVersionExclusive
        )
    }
}

tasks.jar {
    manifest {
        attributes(
            "Implementation-Title" to "Recipe Tree JEI/HEI Exporter",
            "Implementation-Version" to project.version,
            "FMLCorePlugin" to "com.recipetree.jeiexport112.compat.ExportCorePlugin",
            "FMLCorePluginContainsFMLMod" to "true"
        )
    }
}

tasks.named("reobfJar") {
    doLast {
        val reobfuscatedJars = outputs.files.files
            .filter { it.isFile && it.extension == "jar" }
        require(reobfuscatedJars.size == 1) {
            "Expected reobfJar to declare exactly one regular JAR output, found " +
                reobfuscatedJars.joinToString(prefix = "[", postfix = "]") { it.absolutePath }
        }
        val embed = project.extra["embedMrtExporterBuildIdentity"] as groovy.lang.Closure<*>
        embed.call(reobfuscatedJars.single(), "forge-hei-1.12.2", "1.12.2")
    }
}
