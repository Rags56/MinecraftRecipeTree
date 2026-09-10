package com.recipetree.jeiexport;

import net.minecraft.resources.ResourceLocation;
import org.jetbrains.annotations.Nullable;

import java.io.PrintWriter;
import java.io.StringWriter;

/** One bounded, machine-readable exporter failure with enough context to reproduce it. */
final class ExportFailure {
    private static final int MAX_TEXT = 16_000;

    final String scope;
    @Nullable final String modId;
    @Nullable final String categoryId;
    @Nullable final String recipeId;
    @Nullable final Integer recipeIndex;
    @Nullable final String recipeClass;
    @Nullable final String errorType;
    final String message;
    @Nullable final String details;

    private ExportFailure(
            String scope,
            @Nullable String modId,
            @Nullable String categoryId,
            @Nullable String recipeId,
            @Nullable Integer recipeIndex,
            @Nullable String recipeClass,
            @Nullable String errorType,
            String message,
            @Nullable String details) {
        this.scope = bounded(scope);
        this.modId = nullableBounded(modId);
        this.categoryId = nullableBounded(categoryId);
        this.recipeId = nullableBounded(recipeId);
        this.recipeIndex = recipeIndex;
        this.recipeClass = nullableBounded(recipeClass);
        this.errorType = nullableBounded(errorType);
        this.message = bounded(message);
        this.details = nullableBounded(details);
    }

    static ExportFailure generic(String message) {
        return new ExportFailure("export", null, null, null, null, null, null, message, null);
    }

    static ExportFailure generic(String message, Throwable error) {
        return new ExportFailure(
                "export",
                null,
                null,
                null,
                null,
                null,
                error.getClass().getName(),
                message + ": " + error,
                stackTrace(error));
    }

    static ExportFailure recipe(
            ResourceLocation categoryId,
            @Nullable ResourceLocation recipeId,
            int recipeIndex,
            @Nullable Class<?> recipeClass,
            String message,
            @Nullable Throwable error) {
        String modId = recipeId == null ? categoryId.getNamespace() : recipeId.getNamespace();
        String resolvedMessage = error == null ? message : message + ": " + error;
        return new ExportFailure(
                "recipe",
                modId,
                categoryId.toString(),
                recipeId == null ? null : recipeId.toString(),
                recipeIndex,
                recipeClass == null ? null : recipeClass.getName(),
                error == null ? null : error.getClass().getName(),
                resolvedMessage,
                stackTrace(error));
    }

    @Nullable
    private static String stackTrace(@Nullable Throwable error) {
        if (error == null) return null;
        StringWriter text = new StringWriter();
        error.printStackTrace(new PrintWriter(text));
        return bounded(text.toString());
    }

    private static String bounded(String value) {
        if (value.length() <= MAX_TEXT) return value;
        return value.substring(0, MAX_TEXT - 30) + "\n... exporter text truncated ...";
    }

    @Nullable
    private static String nullableBounded(@Nullable String value) {
        return value == null ? null : bounded(value);
    }
}
